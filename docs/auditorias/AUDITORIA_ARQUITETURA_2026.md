# Auditoria de Arquitetura — Becker GPTs
**Data:** 25 de junho de 2026  
**Escopo:** Repositório `luanaadvocaciabecker-pixel/GPTs-becker`  
**Metodologia:** Leitura integral de todos os arquivos de código, SQL e configuração. Nenhuma modificação foi realizada.

---

## 1. Visão Geral da Estrutura

```
GPTs-becker/
├── data/
│   └── auditada_2026/
│       └── chunks_base_conhecimento_auditada_2026.jsonl   # Base vetorial curada
├── database/
│   ├── 01_schema.sql        # Schema do GPT Bancário (tabelas legadas)
│   └── 02_funcoes_busca.sql # Funções RPC do GPT Bancário (legadas)
├── docs/
│   └── auditorias/
│       ├── DOCUMENTO_PARA_VERIFICAR_NO_JUSBRASIL.txt
│       └── RELATORIO_CONFERENCIA_JUSBRASIL_2026-06-23.md
├── gpts/
│   ├── becker-gpt-bancario/
│   │   ├── action_openapi.yaml   # Schema da Action do GPT Bancário
│   │   └── instrucao_mestra.md   # System prompt do GPT Bancário
│   ├── becker-gpt-trabalhista/
│   │   ├── action_openapi.yaml   # Schema da Action do GPT Trabalhista
│   │   └── instrucao_mestra.md   # System prompt do GPT Trabalhista
│   └── becker-juris-intelligence/
│       ├── action_openapi.yaml   # Schema da Action do Juris Intelligence
│       └── instrucao_mestra.md   # System prompt do Juris Intelligence
├── ingestion/
│   ├── 03_ingestao_google.py          # Script ETL v1 (Google Gemini)
│   ├── 03_ingestao_google_auditada.py # Script ETL v2 — pasta AUDITORIA_2026
│   └── gerar_base_auditada_2026.py    # Gerador do JSONL auditado
├── supabase/
│   ├── config.toml
│   └── functions/
│       ├── becker-juris/
│       │   └── index.ts   # Edge Function principal (1.157 linhas)
│       └── buscar/
│           ├── deno.json
│           └── index.ts   # Edge Function legada (113 linhas)
├── .env.example
├── .gitignore
└── README.md
```

**Tamanho estimado de código:** ~1.300 linhas TypeScript, ~240 linhas SQL, ~300 linhas Python, ~400 linhas Markdown de instrução.

---

## 2. Inventário por Pasta — Responsabilidades

### 2.1 `supabase/functions/buscar/` — Edge Function Legada
**Responsabilidade:** API de busca semântica para os GPTs Bancário e Trabalhista.

| Arquivo | Função |
|---|---|
| `index.ts` | Recebe `{query, tabela, filtros}`, gera embedding via Google Gemini (`gemini-embedding-001`, 768d), executa RPC `buscar_base` ou `buscar_jurisprudencia` no Supabase, retorna `{resultados}` |
| `deno.json` | Import map Deno — apenas declara `jsr:@supabase/supabase-js@2` |

**Características:** Função compacta (113 linhas), responsabilidade única, sem lógica de negócio embutida. Embedding é feito pela API externa do Google — dependência de rede crítica no caminho de resposta.

---

### 2.2 `supabase/functions/becker-juris/` — Edge Function Principal (Juris Intelligence)
**Responsabilidade:** API de pesquisa jurisprudencial auditável com auto-ingesta, rastreabilidade e geração de artefatos citáveis.

O arquivo único `index.ts` concentra **seis responsabilidades distintas**:

| Bloco | Linhas aprox. | Responsabilidade |
|---|---|---|
| DataJud connector | 20–135 | Consulta à API pública do CNJ/DataJud para descoberta de metadados |
| TJSC connector | 136–395 | Scraping do portal eproc do TJSC, download e parsing do inteiro teor (HTML, Windows-1252) |
| TST connector | 390–570 | Consulta ao backend da jurisprudência do TST, normalização de campos |
| Core de embedding | 572–618 | Hash FNV-128 normalizado como pseudo-embedding vetorial |
| Core de citação/artefato | 619–896 | Formatação de ementa, `becker_headnote`, extração de fundamentação, serialização de artefato |
| Roteador HTTP | 898–1157 | `Deno.serve` com rotas: `/health`, `/privacy`, `/methodologies`, `/ingest/tjsc`, `/ingest/jt`, `/discover/tjsc`, `/research/theme`, `/research/:id` |

---

### 2.3 `database/` — Schema Legado
**Responsabilidade:** Define estrutura do banco para os GPTs Bancário e Trabalhista (função `buscar`).

| Arquivo | Tabelas/Funções |
|---|---|
| `01_schema.sql` | `base_conhecimento` (chunks com embedding 768d), `jurisprudencia` (precedentes com status de verificação), índices HNSW e GIN, triggers de auditoria |
| `02_funcoes_busca.sql` | `buscar_base` (busca híbrida vetor+FTS com filtros de pasta/matéria), `buscar_jurisprudencia` (busca com trava incondicional: só retorna `VERIFICADO`) |

**Ausente:** Schema completo do `becker-juris` (tabelas `bji_documents`, `bji_chunks`, `bji_methodologies`, `bji_research_artifacts`, `bji_citation_units`, `bji_research_runs`, `bji_processing_runs`, `bji_api_keys`, `bji_discovery_runs` e RPCs `bji_hybrid_search`, `bji_persist_document`, `bji_persist_research`) — **existem apenas em produção, sem arquivo SQL no repositório**.

---

### 2.4 `gpts/` — Configuração dos GPTs
**Responsabilidade:** System prompts e schemas OpenAPI publicados no ChatGPT.

| GPT | Arquivo | Backend |
|---|---|---|
| `becker-gpt-bancario` | `instrucao_mestra.md` + `action_openapi.yaml` | `buscar` (Edge Function legada) |
| `becker-gpt-trabalhista` | `instrucao_mestra.md` + `action_openapi.yaml` | `buscar` (mesma Edge Function) |
| `becker-juris-intelligence` | `instrucao_mestra.md` + `action_openapi.yaml` | `becker-juris` (Edge Function principal) |

Os três GPTs têm arquivos espelhados no mesmo layout, mas apontam para backends diferentes e têm instruções independentes — sem compartilhamento de fragmentos comuns.

---

### 2.5 `ingestion/` — Scripts de Ingestão
**Responsabilidade:** Preparação e carga inicial da base de conhecimento no Supabase.

| Script | Função |
|---|---|
| `03_ingestao_google.py` | ETL v1: lê `.txt`, divide em chunks, gera embeddings via Google Gemini, insere em `base_conhecimento` |
| `03_ingestao_google_auditada.py` | ETL v2: lê o JSONL auditado, re-gera embeddings e insere com `pasta=AUDITORIA_2026` |
| `gerar_base_auditada_2026.py` | Pré-processamento editorial: lê `.txt` originais, gera chunks limpos e salva como JSONL para revisão humana |

---

### 2.6 `data/auditada_2026/`
Arquivo JSONL com os chunks já revisados editorialmente. Serve como fonte para `03_ingestao_google_auditada.py`. É um artefato de dados, não código — mas está no repositório e versiona a base de conhecimento bancária.

---

### 2.7 `docs/auditorias/`
Documentação operacional — relatório de conferência de julgados e lista de processos a verificar. Não há padrão estabelecido de localização ou nomenclatura para documentos técnicos de arquitetura.

---

## 3. Duplicações e Inconsistências

### 3.1 Dois motores de embedding incompatíveis em produção

| Sistema | Embedding | Dimensões | Qualidade |
|---|---|---|---|
| `buscar` / GPTs Bancário e Trabalhista | Google Gemini `gemini-embedding-001` | 768 | Semântico real, treinado em linguagem jurídica |
| `becker-juris` / Juris Intelligence | Hash FNV local (`embedding()` em TypeScript) | 128 | Aproximador lexical, **não semântico** |

**Impacto:** O Juris Intelligence tem busca semântica degradada. Consultas como "alienação fiduciária" não encontram documentos sobre "fidejussória" ou "garantia real" — termos lexicalmente distintos, semanticamente próximos. O sistema depende mais do full-text lexical do `bji_hybrid_search` do que do vetor. Como contrapeso, a auto-ingesta compensa parcialmente — mas ao custo de latência (1–4s de scraping web por busca fria).

### 3.2 Lógica de chunking duplicada entre Python e TypeScript

`buildChunks()` em `becker-juris/index.ts` (linhas 230–263) e a lógica de chunking em `03_ingestao_google.py` / `03_ingestao_google_auditada.py` implementam a mesma estratégia (janela de 1800 chars, quebra por ponto/ponto-e-vírgula, sobreposição implícita). São implementações independentes em linguagens diferentes, com parâmetros levemente distintos — qualquer mudança de estratégia exige alteração dupla.

### 3.3 Normalização de texto duplicada

`compactText()`, `stripHtml()`, remoção de acentos e tokenização são reimplementados tanto nos scripts Python quanto em TypeScript (funções `compactText`, `normalizedTerms`, `expandLegalAcronyms`). O vocabulário de stopwords também é duplicado com diferenças sutis.

### 3.4 Dois schemas de banco incompatíveis no mesmo projeto

O `database/01_schema.sql` define `base_conhecimento` e `jurisprudencia` (embeddings 768d, sem rastreabilidade, sem RPC de persitência auditável). O `becker-juris` usa `bji_documents`, `bji_chunks`, `bji_research_artifacts`, etc. — schema completamente diferente, sem relação entre os dois conjuntos. Ambos coexistem no mesmo banco Supabase de produção.

### 3.5 Dois conjuntos de instrução para áreas que se sobrepõem

O GPT Bancário e o Juris Intelligence têm instruções independentes para área `bancario`. Ambos respondem a perguntas sobre RMC/RCC, mas com bases de dados diferentes (knowledge base editorial vs. acervo de acórdãos). Não há instrução clara ao usuário sobre qual usar para qual finalidade.

---

## 4. Responsabilidades Misturadas

### 4.1 `becker-juris/index.ts` — God File

O arquivo tem **1.157 linhas** e mistura:
1. **Conectores externos** (DataJud, TJSC eproc, TST backend) — lógica de scraping web, parsing HTML, decodificação de charset, normalização de campos de API
2. **Motor de embedding** — implementação de hash FNV como vetor
3. **Motor de citação jurídica** — formatação de ementa, extração de segmentos por padrão regex, construção da Ementa Becker
4. **Lógica de persistência** — chamadas à RPC `bji_persist_document`, upload para Storage, deduplicação por hash
5. **Lógica de pesquisa** — filtros por área, jurisdição, prioridade de tribunal, ranking, seleção de documentos canônicos
6. **Roteador HTTP** — parsing de rotas e despacho de handlers

Toda modificação em qualquer uma dessas áreas exige ler e entender o arquivo inteiro.

### 4.2 `buscar/index.ts` — Privacy Policy embutida

A política de privacidade do GPT Bancário está hardcoded como template HTML dentro da Edge Function (linhas 105–113). Isso mistura conteúdo editorial com código de infraestrutura — qualquer atualização de texto exige redeploy da função.

### 4.3 `gpts/becker-gpt-bancario/instrucao_mestra.md` — Instrução e Regra Operacional misturadas

O system prompt define simultaneamente: persona do assistente, regras de comportamento, fluxo de consulta, lista de matérias com cobertura insuficiente, e triagem de documentos do advogado. O bloco "Limites atuais da base" é informação operacional que muda com frequência mas está embarcada no prompt — exige edição no ChatGPT a cada atualização do acervo.

---

## 5. Oportunidades de Modularização

### 5.1 Separar conectores em módulos próprios
Cada conector (DataJud, TJSC eproc, TST) poderia ser um arquivo TypeScript independente em `supabase/functions/_shared/connectors/`. Benefício: testabilidade isolada, deploys sem risco de regressão nos demais conectores.

### 5.2 Extrair motor de embedding para módulo compartilhado
`embedding()`, `normalizedTerms()`, `expandLegalAcronyms()` e `compactText()` são usados em dois contextos distintos dentro de `becker-juris`. Extraí-los para `_shared/text.ts` elimina duplicação e abre caminho para substituição futura por Google Gemini (alinhando com `buscar`).

### 5.3 Extrair motor de citação
`buildStructuredArtifacts()`, `citationForPetition()`, `headnoteSegments()`, `officialHeadnoteSections()` formam um núcleo de geração de artefato jurídico que poderia ser isolado em `_shared/citation.ts`. Isso permitiria que outros GPTs (Bancário, Trabalhista) gerassem artefatos no mesmo formato sem duplicar lógica.

### 5.4 Criar schema SQL para `becker-juris` no repositório
As 9+ tabelas `bji_*` existem apenas em produção. Criar `database/03_schema_bji.sql` e `database/04_funcoes_bji.sql` tornaria o banco reproduzível a partir do zero — requisito mínimo de continuidade operacional.

### 5.5 Criar fragmentos compartilhados de instrução
Regras comuns entre os três GPTs (proibição de inventar jurisprudência, triagem antes de redigir, estilo Becker) poderiam ser mantidas em `gpts/_shared/regras_comuns.md` e referenciadas nas instruções individuais. Atualmente, qualquer mudança de política exige edição manual nos três GPTs.

---

## 6. Avaliação por Camada

### 6.1 Edge Functions

| Critério | `buscar` | `becker-juris` |
|---|---|---|
| Coesão | Alta (1 responsabilidade clara) | Baixa (6 responsabilidades) |
| Tamanho | Adequado (113 linhas) | Crítico (1.157 linhas) |
| Testabilidade | Boa (lógica delgada, I/O externo isolável) | Difícil (conectores e lógica de domínio entrelaçados) |
| Reproduzibilidade | Alta (schema no repo) | Baixa (schema ausente) |
| Declarado em config.toml | Sim | **Não** |
| Embedding | Google Gemini 768d (semântico) | FNV 128d (lexical) |

### 6.2 GPTs (System Prompts)

| Critério | Bancário | Trabalhista | Juris Intelligence |
|---|---|---|---|
| Clareza de persona | Alta | Alta | Alta |
| Clareza de fluxo | Alta | Não avaliado | Alta |
| Acoplamento a estado da base | Alto (lista de lacunas hardcoded) | Não avaliado | Médio |
| Cobertura de casos de borda | Boa | Não avaliado | Boa |

### 6.3 Banco de Dados

| Critério | Schema Legado (`buscar`) | Schema BJI (`becker-juris`) |
|---|---|---|
| Presente no repositório | Sim | **Não** |
| Rastreabilidade auditável | Não | Sim |
| Trava de verificação | Sim (trigger + enum) | Presumida (RPC, não verificável) |
| Embedding | 768d (Gemini) | Não documentado |

---

## 7. Pontos Críticos e Riscos

### P1 — Críticos (risco imediato)

**C1. Schema BJI ausente do repositório**  
Se o banco Supabase for perdido, resetado ou migrado para outro projeto, não existe SQL para recriá-lo. Não há como auditar a estrutura sem acesso direto ao banco de produção.  
*Ação:* Exportar e versionar `database/03_schema_bji.sql` como tarefa de emergência.

**C2. `becker-juris` não declarada em `config.toml`**  
A stanza `[functions.becker-juris]` não existe no arquivo de configuração. Deploys via CLI (`supabase functions deploy`) podem ignorar a função ou exigir flag manual. Em pipelines de CI/CD, a função poderia não ser implantada.  
*Ação:* Adicionar `[functions.becker-juris]` com `verify_jwt = false` e `entrypoint`.

**C3. Embedding incompatível degrada qualidade do Juris Intelligence**  
O FNV-128 não captura proximidade semântica. Para consultas longas (>10 termos), a busca depende quase inteiramente do ranqueamento lexical do PostgreSQL full-text, limitando a cobertura a documentos que compartilham vocabulário exato com a query.

### P2 — Importantes

**I1. `AUDITORIA_TRABALHISTA` declarada no OpenAPI do GPT Trabalhista mas inexistente**  
O schema da Action do GPT Trabalhista referencia a pasta `AUDITORIA_TRABALHISTA` como enum válido. Essa pasta não existe em `base_conhecimento`. Qualquer consulta com esse filtro retorna vazio silenciosamente.

**I2. Ausência de testes automatizados**  
Nenhum arquivo de teste foi encontrado no repositório. Mudanças em `becker-juris/index.ts` (que tem 6 responsabilidades) não têm cobertura verificável. A única validação é o deploy + teste manual no ChatGPT.

**I3. Segredo DataJud hardcoded como fallback**  
`datajudFallbackKey` (linha 18 de `becker-juris/index.ts`) é uma chave Base64 hardcoded como fallback quando o scraping da página de acesso falha. Chaves de API não deveriam estar em código-fonte.

**I4. Auto-ingesta sem timeout explícito**  
O fluxo de auto-ingesta no `/research/theme` (ingestTJSC → re-busca) não tem timeout. Se o TJSC eproc demorar >10s, a Edge Function do Supabase pode expirar antes de retornar, causando erro 504 sem resposta estruturada.

**I5. `upsert: false` no upload TJSC pode gerar erros em reingestão**  
`supabase.storage.from("becker-originals").upload(..., { upsert: false })` — se o documento já existir no Storage (arquivo com mesmo path), o upload lança erro. A deduplicação por hash é feita antes, mas a deduplicação por `source_identifier` não verifica existência no Storage, apenas no banco — pode haver divergência se o banco for parcialmente resetado.

### P3 — Menores

**M1. `supportsQuery` implementada mas não utilizada**  
A função `supportsQuery` (linhas 602–618) existe no arquivo mas não é chamada em nenhum lugar após a refatoração v46. É código morto que adiciona ~20 linhas de ruído e pode causar confusão em manutenções futuras.

**M2. Política de privacidade hardcoded na Edge Function**  
O HTML da política de privacidade está embutido em `buscar/index.ts`. Qualquer atualização de texto exige redeploy da função.

**M3. `createdBy` sempre `"public"` após remoção de autenticação**  
Com a autenticação removida (v45+), `principal.name` é sempre `"public"`. Os campos `created_by` nas tabelas `bji_*` perdem valor de auditoria — não é possível distinguir entre usuários ou sessões.

---

## 8. Recomendações Prioritárias

| Prioridade | Ação | Esforço | Impacto |
|---|---|---|---|
| P1 | Exportar e versionar schema BJI completo em `database/` | Médio | Crítico para continuidade |
| P1 | Declarar `becker-juris` no `config.toml` | Baixo | Evita falha silenciosa em CI |
| P1 | Substituir FNV-128 por Google Gemini 768d no `becker-juris` | Alto | Melhora qualidade de busca significativamente |
| P2 | Remover função `supportsQuery` não utilizada | Baixo | Reduz confusão |
| P2 | Mover `datajudFallbackKey` para secret do Supabase | Baixo | Segurança básica |
| P2 | Adicionar timeout explícito na auto-ingesta | Médio | Evita erros 504 |
| P2 | Corrigir enum `AUDITORIA_TRABALHISTA` no OpenAPI do GPT Trabalhista | Baixo | Evita erro silencioso |
| P3 | Extrair conectores em módulos separados | Alto | Base para múltiplos GPTs |
| P3 | Criar fragmentos de instrução compartilhados entre GPTs | Médio | Reduz drift entre prompts |
| P3 | Adicionar campo de sessão/origem em `created_by` | Médio | Restaura valor de auditoria |

---

*Este documento foi gerado por análise estática do repositório. Nenhum arquivo foi modificado.*
