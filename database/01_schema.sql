-- ============================================================
-- BECKER GPT BANCÁRIO — SCHEMA SUPABASE
-- Embeddings: Google gemini-embedding-001 (768 dimensões)
-- Full-text: português
-- Duas tabelas separadas: base_conhecimento e jurisprudencia
-- Execute este arquivo PRIMEIRO, no SQL Editor do Supabase.
-- ============================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ------------------------------------------------------------
-- TABELA 1: BASE DE CONHECIMENTO (doutrina / estratégia / prova digital)
-- 1 registro = 1 seção (chunk) de um arquivo .txt
-- ------------------------------------------------------------
create table if not exists base_conhecimento (
  id                 bigint generated always as identity primary key,
  chunk_id           text unique not null,           -- hash estável da seção
  pasta              text not null,                  -- FUNDACAO | MATERIAS | IMPUGNACOES | PROVA_DIGITAL_AVANCADA | PECAS_REFERENCIA
  arquivo            text not null,                  -- nome do .txt de origem
  titulo_documento   text,
  secao              text,                           -- título da seção (## ...)
  materia            text,                           -- Empréstimo não contratado | RMC | RCC | Fraude bancária | Golpe PIX | Revisional | Superendividamento ...
  tipo_peca          text,                           -- INICIAL | RÉPLICA | RECURSO | TESES | DOCUMENTOS | RISCOS | IMPUGNAÇÃO ...
  nivel_importancia  text,                           -- CRÍTICO | ALTO | MÉDIO | BAIXO
  frequencia         text,
  palavras_chave     text,
  lacuna             boolean default false,          -- seção marcada como LACUNA NO ACERVO
  conteudo           text not null,
  tokens_aprox       int,
  embedding          vector(768),                    -- gemini-embedding-001
  fts                tsvector generated always as (to_tsvector('portuguese', coalesce(conteudo,''))) stored,
  criado_em          timestamptz default now()
);

-- Índices base_conhecimento
create index if not exists bc_embedding_hnsw on base_conhecimento using hnsw (embedding vector_cosine_ops);
create index if not exists bc_fts_gin        on base_conhecimento using gin (fts);
create index if not exists bc_materia        on base_conhecimento (materia);
create index if not exists bc_tipo           on base_conhecimento (tipo_peca);
create index if not exists bc_pasta          on base_conhecimento (pasta);
create index if not exists bc_nivel          on base_conhecimento (nivel_importancia);
create index if not exists bc_lacuna         on base_conhecimento (lacuna);

-- ------------------------------------------------------------
-- TABELA 2: JURISPRUDÊNCIA (1 registro = 1 precedente)
-- Campos de catalogação OBRIGATÓRIOS (NOT NULL) — impede inserção incompleta.
-- status_verificacao controla o que pode ser citado.
-- ------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'status_verificacao_enum') then
    create type status_verificacao_enum as enum ('VERIFICADO','A_VERIFICAR','SUPERADO','REVOGADO');
  end if;
end $$;

create table if not exists jurisprudencia (
  id                 bigint generated always as identity primary key,
  tema               text not null,                  -- RMC | RCC | Fraude | PIX | Revisional | Busca e apreensão | Superendividamento | Seguro prestamista | Negativação | Tarifas
  subtema            text,
  tese               text not null,                  -- tese extraída do acórdão
  tribunal           text not null,                  -- STJ | TJSC | STF
  processo           text not null,                  -- número do processo/REsp/Tema
  relator            text not null,
  orgao_julgador     text not null,                  -- Turma/Câmara/Seção
  data_julgamento    date  not null,
  ementa             text not null,
  link               text not null,                  -- link OFICIAL do tribunal
  fundamentos        text,                           -- dispositivos/súmulas/temas aplicados
  quando_utilizar    text,                           -- aplicação prática na peça
  status_verificacao status_verificacao_enum not null default 'A_VERIFICAR',
  embedding          vector(768),                    -- embedding de (tese || ementa)
  fts                tsvector generated always as (
                       to_tsvector('portuguese', coalesce(tese,'') || ' ' || coalesce(ementa,''))
                     ) stored,
  criado_em          timestamptz default now(),
  verificado_em      timestamptz,
  verificado_por     text
);

-- Índices jurisprudência
create index if not exists jur_embedding_hnsw on jurisprudencia using hnsw (embedding vector_cosine_ops);
create index if not exists jur_fts_gin        on jurisprudencia using gin (fts);
create index if not exists jur_tema           on jurisprudencia (tema);
create index if not exists jur_tribunal       on jurisprudencia (tribunal);
create index if not exists jur_status         on jurisprudencia (status_verificacao);
-- Não permite dois precedentes idênticos (mesmo processo + tribunal)
create unique index if not exists jur_proc_unico on jurisprudencia (tribunal, processo);

-- Public keys may read through the search RPCs; writes require service_role/secret.
alter table base_conhecimento enable row level security;
alter table jurisprudencia enable row level security;
revoke all on table base_conhecimento from anon, authenticated;
revoke all on table jurisprudencia from anon, authenticated;
grant select on table base_conhecimento to anon, authenticated;
grant select on table jurisprudencia to anon, authenticated;

-- ------------------------------------------------------------
-- TRAVA EXTRA: ao marcar VERIFICADO, exige carimbo de quem/quando verificou
-- ------------------------------------------------------------
create or replace function jur_exige_carimbo_verificacao()
returns trigger language plpgsql as $$
begin
  if new.status_verificacao = 'VERIFICADO' then
    if new.verificado_em is null then new.verificado_em := now(); end if;
    if new.verificado_por is null or length(trim(new.verificado_por)) = 0 then
      raise exception 'Para status VERIFICADO é obrigatório informar verificado_por (quem conferiu na fonte oficial).';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_jur_carimbo on jurisprudencia;
create trigger trg_jur_carimbo before insert or update on jurisprudencia
  for each row execute function jur_exige_carimbo_verificacao();
