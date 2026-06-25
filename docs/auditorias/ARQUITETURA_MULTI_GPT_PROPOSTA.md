# Proposta de Arquitetura Multi-GPT — Becker Core Compartilhado
**Baseado em:** AUDITORIA_ARQUITETURA_2026.md  
**Data:** 25 de junho de 2026  
**Status:** Proposta — nenhum código alterado

---

## 1. Problema que esta proposta resolve

O repositório tem três GPTs (Bancário, Trabalhista, Juris Intelligence) que cresceram de forma independente e hoje têm:

- Dois backends completamente diferentes (`buscar` e `becker-juris`) com motores de embedding incompatíveis
- Lógica de chunking, normalização de texto e formatação de citação duplicada
- Schema de banco sem rastreabilidade auditável para dois dos três GPTs
- System prompts com regras comuns escritas três vezes separadamente
- Nenhum mecanismo para adicionar um quarto GPT sem reescrever tudo do zero

A proposta a seguir cria um **Becker Core** — camada compartilhada de infraestrutura — sobre o qual cada GPT é apenas uma configuração, não um produto separado.

---

## 2. Visão da Arquitetura Alvo

```
┌─────────────────────────────────────────────────────────┐
│                    ChatGPT (usuários)                   │
├──────────────┬──────────────┬──────────────┬────────────┤
│  GPT Bancário│GPT Trabalhista│GPT Criminal │GPT Juris   │
│  (persona)   │  (persona)   │  (persona)  │Intelligence│
│  instrucao_  │  instrucao_  │  instrucao_ │(persona)   │
│  mestra.md   │  mestra.md   │  mestra.md  │            │
│              │              │             │            │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Fragmentos Compartilhados (_shared/)     │  │
│  │  regras_auditoria.md · estilo_becker.md          │  │
│  │  regras_lacuna.md · triagem_obrigatoria.md       │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                          │ HTTPS (Actions)
                          ▼
┌─────────────────────────────────────────────────────────┐
│           Supabase Edge Functions (becker-core)         │
│                                                         │
│  /buscar   ──► _shared/search.ts   (hybrid search)      │
│  /research ──► _shared/research.ts (artifact gen)       │
│  /ingest   ──► _shared/connectors/ (TJSC, TST, DataJud) │
│  /discover ──► _shared/connectors/datajud.ts            │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │       _shared/ (módulos compartilhados)         │    │
│  │  embedding.ts  · text.ts  · citation.ts         │    │
│  │  connectors/tjsc.ts · connectors/tst.ts         │    │
│  │  connectors/datajud.ts                          │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                          │ SQL (RPC)
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Supabase PostgreSQL                    │
│                                                         │
│  bji_documents  bji_chunks  bji_methodologies           │
│  bji_research_artifacts  bji_citation_units             │
│  bji_research_runs  bji_processing_runs                 │
│  bji_api_keys  bji_discovery_runs                       │
│                                                         │
│  base_conhecimento  jurisprudencia  (legado, mantido)   │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Princípios da Arquitetura Proposta

### 3.1 Um único backend, múltiplos GPTs
Todos os GPTs apontam para **a mesma Edge Function** (`becker-core`), parametrizável por `area` e `gpt_id`. A persona de cada GPT é definida apenas no system prompt — o backend não sabe com qual GPT está falando.

### 3.2 Módulos compartilhados, não cópias
Lógica de domínio (embedding, chunking, citação, normalização) fica em `supabase/functions/_shared/`. Cada módulo tem interface clara e é importado pelos handlers de rota.

### 3.3 Um único motor de embedding
Substituir FNV-128 por Google Gemini `gemini-embedding-001` (768d) uniformiza a qualidade de busca em todos os GPTs. O modelo já está em uso e pago no `buscar`.

### 3.4 Schema BJI como único schema de banco
As tabelas `bji_*` têm rastreabilidade auditável completa. O schema legado (`base_conhecimento`, `jurisprudencia`) é mantido em modo leitura para compatibilidade, mas novos dados são inseridos apenas no schema BJI.

### 3.5 Fragmentos de instrução versionados
Regras comuns ficam em `gpts/_shared/` como arquivos `.md` referenciados. Cada GPT inclui seu fragmento de persona + os fragmentos compartilhados necessários.

---

## 4. Estrutura de Pastas Proposta

```
GPTs-becker/
├── database/
│   ├── 01_schema_legado.sql          # Mantido — base_conhecimento + jurisprudencia
│   ├── 02_funcoes_legado.sql         # Mantido — buscar_base + buscar_jurisprudencia
│   ├── 03_schema_bji.sql             # NOVO: tabelas bji_* (exportar de produção)
│   └── 04_funcoes_bji.sql            # NOVO: bji_hybrid_search, bji_persist_*
│
├── gpts/
│   ├── _shared/
│   │   ├── regras_auditoria.md       # "Nunca inventar número de processo..."
│   │   ├── estilo_becker.md          # Narrativa em 4 tempos, redação assertiva
│   │   ├── triagem_obrigatoria.md    # Lista de dados a solicitar antes de redigir
│   │   └── regras_lacuna.md          # Como tratar lacunas na base
│   ├── becker-gpt-bancario/
│   │   ├── instrucao_mestra.md       # Persona + referências a _shared/
│   │   └── action_openapi.yaml       # Aponta para /buscar (legado, mantido)
│   ├── becker-gpt-trabalhista/
│   │   ├── instrucao_mestra.md
│   │   └── action_openapi.yaml
│   ├── becker-gpt-criminal/          # NOVO: exemplo de extensão
│   │   ├── instrucao_mestra.md
│   │   └── action_openapi.yaml
│   └── becker-juris-intelligence/
│       ├── instrucao_mestra.md
│       └── action_openapi.yaml       # Aponta para /research/theme (becker-core)
│
├── supabase/
│   ├── config.toml                   # Declara todas as functions
│   └── functions/
│       ├── _shared/                  # NOVO: módulos compartilhados
│       │   ├── text.ts               # compactText, normalizedTerms, expandLegalAcronyms
│       │   ├── embedding.ts          # generateEmbedding() → Google Gemini 768d
│       │   ├── chunking.ts           # buildChunks() padronizado
│       │   ├── citation.ts           # citationForPetition, headnoteSegments, buildStructuredArtifacts
│       │   └── connectors/
│       │       ├── tjsc.ts           # fetchTJSCResults, ingestTJSC
│       │       ├── tst.ts            # fetchTSTResults, ingestJT
│       │       └── datajud.ts        # queryDatajud, rmcDatajudRequest
│       ├── becker-core/              # NOVO: substitui becker-juris + buscar
│       │   └── index.ts             # Roteador + handlers finos (importa _shared/)
│       ├── becker-juris/             # Mantido durante migração
│       │   └── index.ts
│       └── buscar/                   # Mantido durante migração
│           ├── deno.json
│           └── index.ts
│
└── ingestion/
    ├── _shared/
    │   └── text_utils.py             # NOVO: funções comuns extraídas
    ├── 03_ingestao_google.py         # Atualizado para usar _shared/
    ├── 03_ingestao_google_auditada.py
    └── gerar_base_auditada_2026.py
```

---

## 5. Mapa de APIs — Becker Core

A Edge Function `becker-core` exporia as seguintes rotas, consolidando os dois backends atuais:

| Rota | Método | Substitui | Descrição |
|---|---|---|---|
| `/buscar` | POST | `buscar` (legado) | Busca híbrida na knowledge base editorial |
| `/research/theme` | POST | `becker-juris /research/theme` | Pesquisa jurisprudencial com auto-ingesta |
| `/research/:id` | GET | `becker-juris /research/:id` | Recupera artefato auditável por ID |
| `/ingest/tjsc` | POST | `becker-juris /ingest/tjsc` | Captura manual TJSC |
| `/ingest/jt` | POST | `becker-juris /ingest/jt` | Captura manual TST/TRT |
| `/discover/tjsc` | POST | `becker-juris /discover/tjsc` | Descoberta de metadados DataJud |
| `/health` | GET | Ambos | Health check |
| `/privacy` | GET | Ambos | Política de privacidade (arquivo externo) |

Os OpenAPI schemas dos GPTs precisariam apenas atualizar o `servers.url` de `/functions/v1/becker-juris` para `/functions/v1/becker-core` (ou `/functions/v1/buscar` → `/functions/v1/becker-core`).

---

## 6. Modelo de Reutilização de Banco

### 6.1 Migração das tabelas legadas para schema BJI

Todos os precedentes em `jurisprudencia` (atualmente sem rastreabilidade) seriam migrados para `bji_documents` + `bji_chunks` com um script de migração único. A tabela `jurisprudencia` seria mantida em modo `SELECT ONLY` por 90 dias e então arquivada.

A `base_conhecimento` (knowledge base editorial) mantém seu schema atual — não há motivo para migrar dados que têm estrutura distinta (pastas, matérias, tipo de peça).

### 6.2 Parâmetro `source` para separar as bases

O endpoint `/buscar` passaria a aceitar `source: "knowledge_base" | "jurisprudencia"` ao invés de `tabela: "base" | "jurisprudencia"`. Internamente, `knowledge_base` consulta `base_conhecimento` via `buscar_base`, e `jurisprudencia` consulta `bji_documents`/`bji_chunks` via `bji_hybrid_search` — com rastreabilidade auditável.

---

## 7. Modelo de Persona por GPT

Cada GPT continuaria sendo configurado no ChatGPT como um projeto separado, com seu próprio system prompt. O system prompt teria esta estrutura:

```
[FRAGMENTO: gpts/_shared/regras_auditoria.md]

[FRAGMENTO: gpts/_shared/estilo_becker.md]

[PERSONA ESPECÍFICA]
Você é o assistente jurídico especializado em [ÁREA], no padrão do escritório 
Becker Advogados, com foco em [SUBÁREA].

[FLUXO ESPECÍFICO DA ÁREA]
...

[FRAGMENTO: gpts/_shared/triagem_obrigatoria.md]

[FRAGMENTO: gpts/_shared/regras_lacuna.md]
```

Isso garante que qualquer mudança na regra de auditoria (ex.: nova proibição de inventar jurisprudência) é feita em um único arquivo e propagada para todos os GPTs na próxima edição dos prompts.

---

## 8. Adição de um Novo GPT — Processo Proposto

Com a arquitetura alvo, adicionar o GPT Criminal (exemplo) exigiria:

1. **Backend:** Zero alteração — o `becker-core` já suporta qualquer área via parâmetro `area`
2. **Banco:** Alimentar a knowledge base com material de direito penal via script de ingesta existente
3. **GPT:**
   - Criar `gpts/becker-gpt-criminal/instrucao_mestra.md` com persona + referências a `_shared/`
   - Criar `gpts/becker-gpt-criminal/action_openapi.yaml` apontando para `becker-core`
   - Publicar no ChatGPT
4. **Teste:** Verificar que `/buscar` e `/research/theme` com `area=criminal` retornam resultados relevantes

Esforço estimado: 1–2 dias de trabalho (vs. semanas para criar um novo backend do zero).

---

## 9. Plano de Migração — Fases

### Fase 0 — Fundação (pré-requisito, ~1 semana)
**Objetivo:** Tornar o banco reproduzível e registrar a dívida técnica

- [ ] Exportar schema BJI de produção → `database/03_schema_bji.sql`
- [ ] Exportar RPCs BJI de produção → `database/04_funcoes_bji.sql`
- [ ] Declarar `becker-juris` no `config.toml`
- [ ] Remover função `supportsQuery` não utilizada de `becker-juris/index.ts`
- [ ] Mover `datajudFallbackKey` para Supabase Secret (`DATAJUD_FALLBACK_KEY`)

### Fase 1 — Módulos Compartilhados (~2 semanas)
**Objetivo:** Extrair lógica sem alterar comportamento externo

- [ ] Criar `supabase/functions/_shared/text.ts` com `compactText`, `normalizedTerms`, `expandLegalAcronyms`, `stripHtml`
- [ ] Criar `supabase/functions/_shared/chunking.ts` com `buildChunks` padronizado
- [ ] Criar `supabase/functions/_shared/connectors/tjsc.ts`
- [ ] Criar `supabase/functions/_shared/connectors/tst.ts`
- [ ] Criar `supabase/functions/_shared/connectors/datajud.ts`
- [ ] Atualizar `becker-juris/index.ts` para importar dos módulos (sem mudar comportamento)
- [ ] Criar `ingestion/_shared/text_utils.py`

### Fase 2 — Motor de Embedding Unificado (~1 semana)
**Objetivo:** Substituir FNV-128 por Google Gemini no `becker-juris`

- [ ] Criar `supabase/functions/_shared/embedding.ts` com `generateEmbedding()` → Gemini 768d
- [ ] Atualizar `bji_hybrid_search` no banco para trabalhar com vetores 768d
- [ ] Re-indexar documentos BJI existentes com embedding Gemini (script de migração)
- [ ] Atualizar `becker-juris/index.ts` para usar `generateEmbedding` ao invés de `embedding()`
- [ ] Validar qualidade de busca antes e depois

### Fase 3 — Becker Core (~3 semanas)
**Objetivo:** Consolidar os dois backends em um

- [ ] Criar `supabase/functions/becker-core/index.ts` importando todos os módulos `_shared/`
- [ ] Portar handler `/buscar` (atualmente em `buscar/index.ts`) para `becker-core`
- [ ] Portar todos os handlers de `becker-juris` para `becker-core`
- [ ] Declarar `becker-core` no `config.toml`
- [ ] Testes de smoke em staging para todos os endpoints
- [ ] Atualizar OpenAPI dos GPTs Bancário e Trabalhista para apontar para `becker-core`
- [ ] Manter `buscar` e `becker-juris` ativas por 30 dias como fallback

### Fase 4 — Fragmentos de Instrução Compartilhados (~1 semana)
**Objetivo:** Unificar regras comuns entre GPTs

- [ ] Criar `gpts/_shared/regras_auditoria.md`
- [ ] Criar `gpts/_shared/estilo_becker.md`
- [ ] Criar `gpts/_shared/triagem_obrigatoria.md`
- [ ] Criar `gpts/_shared/regras_lacuna.md`
- [ ] Refatorar `instrucao_mestra.md` dos três GPTs para usar os fragmentos
- [ ] Atualizar prompts no ChatGPT

### Fase 5 — Depreciação (após 30 dias de `becker-core` estável)
- [ ] Desativar `buscar` e `becker-juris`
- [ ] Remover stanzas do `config.toml`
- [ ] Arquivar código depreciado em branch `legacy/pre-becker-core`

---

## 10. Riscos da Migração

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Re-indexação com Gemini altera ranking de busca | Alta | Alto | Testar com queries conhecidas antes de migrar; manter índice FNV como fallback temporário |
| Atualização de OpenAPI quebra GPT existente | Média | Médio | Testar no ChatGPT em modo rascunho antes de publicar |
| `becker-core` tem latência maior por importar mais módulos | Baixa | Baixo | Edge Functions Deno têm boot frio — importações adicionais são ms, não segundos |
| Schema BJI em produção diverge do exportado | Média | Alto | Exportar com `pg_dump --schema-only` e validar contra código |

---

*Esta proposta é documentação de planejamento. Nenhum arquivo de código foi alterado.*
