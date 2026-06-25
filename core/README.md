# Becker Core

## Objetivo

O Becker Core é o núcleo compartilhado de todos os GPTs do ecossistema Becker.

Nenhum GPT deve reimplementar funcionalidades existentes no Core.

Toda lógica reutilizável deve ser desenvolvida aqui.

---

# Missão

Centralizar toda a inteligência comum utilizada pelos GPTs especializados.

O Core NÃO possui conhecimento de uma área específica do Direito.

Ele apenas fornece serviços compartilhados.

---

# GPTs consumidores

Atualmente:

- Becker Juris Intelligence
- Becker GPT Bancário + Consumidor

Futuramente:

- Becker Trabalhista
- Becker Previdenciário
- Becker Penal
- Becker Tributário
- Becker Família
- Becker Empresarial

Todos consomem o mesmo Core.

---

# Responsabilidades do Core

## Pesquisa

- Pesquisa jurídica
- Busca vetorial
- Busca textual
- Busca híbrida

---

## Conectores

Responsável por comunicar com:

- STF
- STJ
- TJSC
- TRF4
- CNJ
- DataJud
- outras fontes oficiais

---

## Ingestion

Responsável por:

- importar documentos
- baixar julgados
- atualizar bases
- normalizar dados
- indexar documentos

---

## Inteligência

Responsável por:

- embeddings
- ranking
- reranking
- similaridade
- classificação
- extração de tese
- identificação de ratio decidendi

---

## Validação

Responsável por:

- verificar origem
- verificar integridade
- validar precedentes
- evitar jurisprudência inexistente

---

# O que NÃO pertence ao Core

O Core nunca deve conter:

- prompts de GPT
- instruções de GPT
- petições
- modelos processuais
- estratégia jurídica específica
- textos voltados ao usuário

Essas responsabilidades pertencem aos GPTs especializados.

---

# Arquitetura

Usuário

↓

GPT Especialista

↓

Core

↓

Tribunais / Banco / Vetores

↓

Core

↓

GPT Especialista

↓

Resposta

---

# Regra Fundamental

O Core é reutilizável.

Os GPTs são especializados.

Nunca inverter essa responsabilidade.

---

# Objetivo Final

Construir uma plataforma modular, reutilizável e escalável, onde novos GPTs possam ser criados reutilizando o mesmo núcleo tecnológico sem duplicação de código.