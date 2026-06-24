# GPTs Becker

Repositório dos GPTs e da infraestrutura de conhecimento jurídico do Becker Advogados.

## Projetos atuais

- **Becker GPT Bancário**: GPT personalizado no ChatGPT.
- **Becker Juris Intelligence**: backend Supabase com base vetorial, Edge Function e busca híbrida.

## Estrutura

```text
gpts/
  becker-gpt-bancario/
    instrucao_mestra.md
    action_openapi.yaml

supabase/
  functions/buscar/
    index.ts
    deno.json
  config.toml

database/
  01_schema.sql
  02_funcoes_busca.sql

ingestion/
  03_ingestao_google.py
  03_ingestao_google_auditada.py
  gerar_base_auditada_2026.py

data/
  auditada_2026/
    chunks_base_conhecimento_auditada_2026.jsonl

docs/
  auditorias/
```

## Segurança

Não coloque chaves no repositório.

Use variáveis de ambiente:

- `GOOGLE_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

Arquivos `.env`, pastas temporárias, exports crus da Claude e SQLs intermediários ficam fora do Git.

## Status da base bancária

Em 2026-06-23 foi subida a pasta lógica `AUDITORIA_2026` no Supabase `Becker Juris Intelligence`, com 70 chunks auditados e embeddings Google `gemini-embedding-001`.

Pontos corrigidos relevantes:

- Tema 1085/STJ não deve ser usado como fundamento específico para RMC/RCC.
- Tema 810/STF não se aplica diretamente a contratos bancários privados.
- Tema 204/STF não corresponde à tese de fortuito interno da Súmula 479/STJ.
- Tema 1249/STF tem repercussão geral, mas exige cuidado quanto ao mérito.
- Jurisprudência TJSC genérica deve ser citada apenas com acórdão específico.

## Fluxo recomendado

1. Editar conteúdo ou scripts neste repositório.
2. Validar que não há chaves com busca por `sb_secret_`, `GOOGLE_API_KEY`, `SUPABASE_SERVICE_KEY`.
3. Gerar base auditada quando necessário.
4. Ingerir no Supabase usando variáveis de ambiente.
5. Testar a Edge Function `/buscar`.

