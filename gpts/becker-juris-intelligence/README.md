# Becker Juris Intelligence

GPT especializado em pesquisa e fichamento de jurisprudência para uso imediato em peças processuais da Advocacia Becker.

## Arquivos

- `instrucao_mestra.md` — System prompt completo do GPT
- `action_openapi.yaml` — Spec OpenAPI para a Action que busca na base vetorial
- `fichas/` — Fichas de jurisprudência já catalogadas para alimentar a base

## Como configurar no ChatGPT

1. Criar novo GPT em chat.openai.com
2. Nome: **Becker Juris Intelligence**
3. Colar conteúdo de `instrucao_mestra.md` em "Instructions"
4. Em "Actions", colar conteúdo de `action_openapi.yaml`
5. Configurar autenticação: **API Key** no header `X-API-Key` com a chave do Supabase

## Como alimentar a base

Cada ficha em `fichas/` deve ser processada e inserida na tabela `base_conhecimento`
do Supabase com embedding gerado via a pipeline de ingestão.

## Áreas cobertas

- Bancário (RMC, consignado, PIX, superendividamento)
- Trabalhista (dano moral, rescisão, vínculo, adicionais)
- Cível (responsabilidade civil, contratos, família)
