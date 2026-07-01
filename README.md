# GPTs Becker — Repositório oficial dos 3 GPTs da Becker Advogados

> ⚠️ ATENÇÃO — LEIA ANTES DE MEXER EM QUALQUER COISA
>
> Este repositório contém APENAS o código dos GPTs.
> Não confunda com o `sistema-becker` (gestão de processos, prazos e clientes).

---

## Os 3 GPTs da Becker Advogados

### 1. Becker GPT Bancário/Consumidor
**Onde fica no ChatGPT:** "Becker GPT Bancário/Consumidor"
**Função:** Assistente jurídico interno para Direito Bancário e Direito do Consumidor.
Analisa documentos, identifica teses, pesquisa jurisprudência, elabora minutas, manifestações e estratégias processuais.
**Backend (Supabase):** projeto `Becker Juris Intelligence` (`bpzuktssvdosxlxbaeyl`)
**Edge Function:** `/buscar`
**Tabelas:** `base_conhecimento` + `jurisprudencia`
**Código aqui:** `gpts/becker-gpt-bancario/`

---

### 2. Becker Monitor
**Onde fica no ChatGPT:** "Becker Monitor"
**Função:** Monitoramento processual — acompanha o DJEN (Diário de Justiça Eletrônico Nacional), identifica publicações, prazos e movimentações por processo, cliente ou advogada responsável.
**Backend (Supabase):** projeto `Becker Juris Intelligence` (`bpzuktssvdosxlxbaeyl`)
**Edge Function:** `/becker-monitor`
**Pipeline automático:** `djen-pipeline` (roda todo dia útil às 8h via cron no servidor Oracle)
**Tabelas:** `djen_publicacoes` + `djen_analises`
**Código aqui:** `gpts/becker-monitor/`

---

### 3. Becker Juris Intelligence
**Onde fica no ChatGPT:** "Becker Juris Intelligence"
**Função:** Núcleo de pesquisa jurisprudencial — localiza precedentes, analisa teses, identifica fundamentos aplicáveis e apoia a construção de estratégias processuais e petições.
**Área:** Civil + Bancário + Consumidor (NÃO inclui Trabalhista — sistema separado no futuro)
**Backend (Supabase):** projeto `Becker Juris Intelligence` (`bpzuktssvdosxlxbaeyl`)
**Edge Function:** `/becker-juris`
**Tabelas:** `bji_documents` + `bji_chunks`
**Código aqui:** `supabase/functions/becker-juris/`

---

## Projetos Supabase — qual é qual

| Nome no Supabase | ID | Para que serve |
|---|---|---|
| **Becker Juris Intelligence** | `bpzuktssvdosxlxbaeyl` | Os 3 GPTs + DJEN pipeline |
| **Becker Advogados** | `fnuzhypsqvyolqqafrba` | Sistema interno de gestão (processos, prazos, clientes) — NÃO é GPT |

---

## Repositórios GitHub — qual é qual

| Repo | Conteúdo |
|---|---|
| **`gpts-becker`** (este aqui) | Código dos 3 GPTs + DJEN |
| **`sistema-becker`** | Gestão de processos, Cloudflare Worker — NÃO confundir com GPTs |

---

## Estrutura de pastas

```
gpts/
  becker-gpt-bancario/
    instrucao_mestra.md       ← prompt do GPT Bancário/Consumidor
    action_openapi.yaml       ← action que conecta ao /buscar

  becker-monitor/
    instrucao_mestra.md       ← prompt do Becker Monitor
    action_openapi.yaml       ← action que conecta ao /becker-monitor

  becker-juris-intelligence/
    instrucao_mestra.md       ← prompt do Becker Juris Intelligence
    action_openapi.yaml       ← action que conecta ao /becker-juris

supabase/
  functions/
    buscar/                   ← serve o GPT Bancário/Consumidor
    becker-monitor/           ← serve o Becker Monitor + recebe DJEN
    becker-juris/             ← serve o Becker Juris Intelligence
    djen-pipeline/            ← coleta e analisa publicações do PJe (automático, não é GPT)

database/
  01_schema.sql
  02_funcoes_busca.sql

ingestion/
  scripts de ingestão de jurisprudência

data/
  auditada_2026/
```

---

## Segurança — NUNCA coloque no repositório

- Chaves de API (`GOOGLE_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_KEY`)
- Tokens (`PIPELINE_SECRET`, `WHATSAPP_TOKEN`)
- Arquivos `.env`

Use sempre variáveis de ambiente no painel do Supabase.

---

## Chaves de API — onde ficam

Todas no Supabase projeto **Becker Juris Intelligence** (`bpzuktssvdosxlxbaeyl`) → Settings → Edge Functions:

| Nome do secret | Para que serve |
|---|---|
| `GEMINI_API_KEY` | Análise de publicações DJEN com Gemini 2.0 Flash |
| `GOOGLE_API_KEY` | Embeddings para busca semântica |
| `PIPELINE_SECRET` | Autenticação do cron Oracle (`becker2026djen`) |

---

## Cron automático DJEN

- **Servidor:** Oracle VM `163.176.240.219`
- **Horário:** Todo dia útil às **8h (horário de Brasília)**
- **O que faz:** Busca publicações do PJe → analisa com Gemini 2.0 Flash → salva no banco → Becker Monitor consulta
