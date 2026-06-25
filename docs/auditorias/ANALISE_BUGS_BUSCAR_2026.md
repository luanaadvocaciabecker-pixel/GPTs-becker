# Análise de Bugs e Gargalos — `supabase/functions/buscar/index.ts`
**Data:** 25 de junho de 2026  
**Arquivo analisado:** `supabase/functions/buscar/index.ts` (113 linhas)  
**Metodologia:** Leitura estática do código. Nenhuma modificação realizada.

---

## Sumário Executivo

A função `buscar` é simples e bem estruturada. Não contém bugs de lógica aparente. Os problemas identificados são de **resiliência e gargalo de desempenho** — a maioria relacionada ao fato de que **toda a latência de resposta depende de uma chamada de rede externa** (Google Gemini API) que não tem retry, timeout explícito nem circuit breaker.

---

## 1. Gargalo Crítico — Embedding no Caminho Crítico sem Timeout

**Arquivo:** `index.ts`, linhas 45–65  
**Código relevante:**
```typescript
const embResp = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
  { method: "POST", headers: {...}, body: JSON.stringify({...}) }
);
if (!embResp.ok) {
  console.error("Google embedding error", embResp.status, await embResp.text());
  return json({ error: "Falha ao gerar embedding no Google." }, 502);
}
```

**Problema:**  
O `fetch` nativo do Deno não tem timeout padrão. Se a API do Google demorar ou não responder, a Edge Function do Supabase fica suspensa até o timeout global da plataforma (~60s ou conforme configurado no projeto). Durante esse tempo:
- A requisição do ChatGPT para o GPT aguarda resposta
- O usuário vê o GPT "travado" — comportamento exatamente descrito pelo usuário ("vc fica travando")
- Não há retry automático

**Causa das travadas observadas:**  
Este é o candidato mais provável para as "travadas" relatadas. Quando a API do Google está lenta (comum em picos de carga ou na região us-east) e a Edge Function leva 30–60s para responder, o ChatGPT pode encerrar a conexão com timeout próprio, e o GPT para de responder ao usuário.

**Sugestão de otimização:**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s máximo
try {
  const embResp = await fetch(url, { ...opts, signal: controller.signal });
  // ...
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    return json({ error: "Timeout ao gerar embedding." }, 504);
  }
  throw error;
} finally {
  clearTimeout(timeoutId);
}
```

---

## 2. Gargalo — Sem Retry em Falha Transitória do Google Gemini

**Arquivo:** `index.ts`, linhas 61–64

**Problema:**  
Se a API do Google retornar HTTP 429 (rate limit), 503 (overloaded) ou falha de rede transitória, a função retorna imediatamente `502` ao ChatGPT. O GPT então não consegue resposta e o usuário vê erro.

Em produção, picos de uso de vários advogados simultaneamente podem facilmente atingir o limite de requisições simultâneas gratuitas da API Gemini.

**Sugestão de otimização:**  
Implementar retry com backoff exponencial para status 429 e 503:
```typescript
async function generateEmbedding(query: string, key: string, retries = 2): Promise<number[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url, opts);
    if (resp.ok) return (await resp.json()).embedding.values;
    if (resp.status === 429 || resp.status === 503) {
      if (attempt < retries) await new Promise(r => setTimeout(r, (attempt + 1) * 1000));
      continue;
    }
    throw new Error(`Embedding HTTP ${resp.status}`);
  }
  throw new Error("Embedding falhou após retries");
}
```

---

## 3. Bug Potencial — Propriedade `embedding.values` sem validação

**Arquivo:** `index.ts`, linha 65  
**Código:**
```typescript
const emb = (await embResp.json()).embedding.values;
```

**Problema:**  
Se a resposta da API do Google vier com estrutura inesperada (ex.: modelo depreciado, mudança de versão da API, resposta de erro com `200 OK`), `embedding.values` será `undefined`. A linha seguinte passa `emb` para o Supabase RPC como `query_embedding: emb` — se for `undefined`, o PostgreSQL receberá `null` onde espera `vector(768)`, causando erro do banco com mensagem opaca para o usuário.

**Sugestão:**
```typescript
const payload = await embResp.json();
const emb: number[] | undefined = payload?.embedding?.values;
if (!Array.isArray(emb) || emb.length !== EMBED_DIM) {
  console.error("Embedding inesperado:", JSON.stringify(payload).slice(0, 200));
  return json({ error: "Resposta de embedding inválida." }, 502);
}
```

---

## 4. Bug Potencial — `k` não validado como inteiro

**Arquivo:** `index.ts`, linha 68  
**Código:**
```typescript
const matchCount = Math.min(Math.max(Number(k) || 8, 1), 20);
```

**Problema:**  
Se `k` vier como `NaN` (ex.: `k: "abc"`), `Number("abc")` retorna `NaN`, e `NaN || 8` resolve `8` — comportamento correto nesse caso. Porém, se vier como `k: 0`, `Number(0) || 8` resolve `8` também, ignorando a intenção do cliente de solicitar 0 resultados (que pode ser um caso de uso válido para teste). É um comportamento silenciosamente inesperado, não um bug crítico.

**Sem impacto em produção** — apenas inconsistência de contrato.

---

## 5. Bug Menor — Rota `/privacy` não declarada no OpenAPI

**Arquivo:** `index.ts`, linhas 8–11  
**Código:**
```typescript
if (req.method === "GET" && url.pathname.endsWith("/privacy")) {
  return new Response(PRIVACY_POLICY, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
```

**Problema:**  
A rota `GET /buscar/privacy` existe e serve HTML, mas **não está declarada no `action_openapi.yaml`** do GPT Bancário. Isso significa que o ChatGPT não sabe que ela existe — ela só é acessível por URL direta, não via Action. Se o OpenAPI for validado automaticamente (ex.: por scanner de conformidade), essa rota fantasma pode causar confusão.

**Sem impacto funcional.**

---

## 6. Gargalo — Sem Cache de Embedding para Queries Repetidas

**Arquivo:** `index.ts`, linhas 45–65

**Problema:**  
Cada chamada ao GPT gera um novo embedding, mesmo que a query seja idêntica a uma anterior. Em um escritório com múltiplos advogados fazendo perguntas similares (ex.: "teses para RMC com dano moral" é consultada dezenas de vezes por dia), cada chamada paga latência de rede (~200–400ms) e conta no limite de requisições da API Gemini.

**Sugestão de otimização (médio prazo):**  
Implementar cache de embedding em tabela Supabase:
```sql
CREATE TABLE becker_embedding_cache (
  query_hash text PRIMARY KEY,
  embedding vector(768),
  cached_at timestamptz DEFAULT now()
);
```
Antes de chamar o Google, verificar se o hash SHA-256 da query existe no cache. TTL de 7 dias seria suficiente para queries jurídicas que não mudam.

---

## 7. Observação — Ausência de Log Estruturado

**Arquivo:** `index.ts`, linhas 91–96  
**Código:**
```typescript
if (error) {
  console.error("Supabase RPC error", error);
  return json({ error: "Falha ao consultar a base." }, 500);
}
```

**Problema:**  
Os erros são logados como `console.error` com string livre. No painel Supabase Edge Function Logs, esses erros aparecem como texto não estruturado — impossível filtrar por tipo de erro, query que falhou, ou tabela afetada. Em um incidente, identificar se é problema de embedding, de RPC ou de payload requer ler os logs um a um.

**Sugestão:**
```typescript
console.error(JSON.stringify({
  event: "rpc_error",
  rpc,
  query: query.slice(0, 100),
  error: error.message,
  code: error.code,
}));
```

---

## 8. Observação — Privacy Policy em Português sem Acentos

**Arquivo:** `index.ts`, linhas 105–113

O HTML da política de privacidade tem frases sem acentos ("Politica de Privacidade", "integracao", "nao"). Isso é esteticamente inadequado para um site jurídico. Provavelmente resultado de encoding manual para evitar erros de encoding em ambientes antigos — mas com `charset=utf-8` declarado, não há razão técnica para omitir acentos.

**Sem impacto funcional.** Corrigível ao mover o HTML para arquivo externo.

---

## Resumo dos Achados

| # | Tipo | Severidade | Linha | Descrição |
|---|---|---|---|---|
| 1 | Gargalo | **Crítico** | 45–65 | `fetch` sem timeout — causa travadas de 30–60s |
| 2 | Gargalo | **Alto** | 61–64 | Sem retry em 429/503 do Google Gemini |
| 3 | Bug potencial | **Médio** | 65 | `embedding.values` sem validação de estrutura |
| 4 | Bug menor | Baixo | 68 | `k=0` silenciosamente substituído por `k=8` |
| 5 | Inconsistência | Baixo | 8–11 | Rota `/privacy` não declarada no OpenAPI |
| 6 | Gargalo | Médio | 45–65 | Sem cache de embedding para queries repetidas |
| 7 | Observabilidade | Baixo | 91–96 | Logs não estruturados dificultam diagnóstico |
| 8 | Qualidade | Info | 105–113 | HTML sem acentos na política de privacidade |

**Causa mais provável das travadas relatadas:** Item 1 — ausência de timeout no `fetch` para a API do Google Gemini. Uma única chamada lenta bloqueia a função inteira por até 60 segundos.

---

*Este documento é resultado de análise estática. Nenhum arquivo foi modificado.*
