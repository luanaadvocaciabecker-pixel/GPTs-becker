-- ============================================================
-- BECKER GPT — FUNÇÕES DE BUSCA HÍBRIDA
-- Ordem recomendada (validada): filtro por metadados -> full-text -> vetor.
-- Execute este arquivo DEPOIS do 01_schema.sql.
-- ============================================================

-- ------------------------------------------------------------
-- BUSCA NA BASE DE CONHECIMENTO (híbrida)
-- Combina similaridade vetorial (cosine) + ranking full-text (português),
-- com filtros opcionais por matéria, tipo de peça, pasta e nível.
-- Fusão por soma ponderada (vetor 0.6 / fts 0.4) — ajustável.
-- ------------------------------------------------------------
create or replace function buscar_base(
  query_text       text,
  query_embedding  vector(768),
  p_materia        text default null,
  p_tipo_peca      text default null,
  p_pasta          text default null,
  p_nivel          text default null,
  incluir_lacuna   boolean default true,   -- false = não retorna seções de LACUNA
  match_count      int  default 8,
  peso_vetor       float default 0.6,
  peso_fts         float default 0.4
)
returns table (
  chunk_id text, pasta text, arquivo text, titulo_documento text, secao text,
  materia text, tipo_peca text, nivel_importancia text, lacuna boolean,
  conteudo text, score float
) language sql stable as $$
  with filtrado as (
    select * from base_conhecimento b
    where (p_materia   is null or b.materia = p_materia)
      and (p_tipo_peca is null or b.tipo_peca = p_tipo_peca)
      and (p_pasta     is null or b.pasta = p_pasta)
      and (p_nivel     is null or b.nivel_importancia = p_nivel)
      and (incluir_lacuna or b.lacuna = false)
  ),
  vetor as (
    select chunk_id, 1 - (embedding <=> query_embedding) as sim
    from filtrado
    where embedding is not null
    order by embedding <=> query_embedding
    limit greatest(match_count * 4, 40)
  ),
  texto as (
    select chunk_id, ts_rank(fts, websearch_to_tsquery('portuguese', coalesce(query_text,''))) as rnk
    from filtrado
    where query_text is not null
      and fts @@ websearch_to_tsquery('portuguese', query_text)
    order by rnk desc
    limit greatest(match_count * 4, 40)
  )
  select f.chunk_id, f.pasta, f.arquivo, f.titulo_documento, f.secao,
         f.materia, f.tipo_peca, f.nivel_importancia, f.lacuna, f.conteudo,
         (
           peso_vetor * coalesce(v.sim,0)
           + peso_fts * coalesce(t.rnk,0)
           + case when f.pasta = 'AUDITORIA_2026' then 0.35 else 0 end
         ) as score
  from filtrado f
  left join vetor v on v.chunk_id = f.chunk_id
  left join texto t on t.chunk_id = f.chunk_id
  where v.chunk_id is not null or t.chunk_id is not null
  order by score desc
  limit match_count;
$$;

-- ------------------------------------------------------------
-- BUSCA NA JURISPRUDÊNCIA (híbrida) — TRAVA DE SEGURANÇA
-- SÓ retorna precedentes VERIFICADO. Nunca A_VERIFICAR/SUPERADO/REVOGADO.
-- Não há parâmetro para desligar essa trava — é incondicional.
-- ------------------------------------------------------------
create or replace function buscar_jurisprudencia(
  query_text       text,
  query_embedding  vector(768),
  p_tema           text default null,
  p_tribunal       text default null,
  match_count      int  default 6,
  peso_vetor       float default 0.6,
  peso_fts         float default 0.4
)
returns table (
  tema text, subtema text, tese text, tribunal text, processo text,
  relator text, orgao_julgador text, data_julgamento date,
  ementa text, link text, quando_utilizar text, score float
) language sql stable as $$
  with filtrado as (
    select * from jurisprudencia j
    where j.status_verificacao = 'VERIFICADO'          -- <<< TRAVA INCONDICIONAL
      and (p_tema     is null or j.tema = p_tema)
      and (p_tribunal is null or j.tribunal = p_tribunal)
  ),
  vetor as (
    select id, 1 - (embedding <=> query_embedding) as sim
    from filtrado where embedding is not null
    order by embedding <=> query_embedding limit greatest(match_count*4,30)
  ),
  texto as (
    select id, ts_rank(fts, websearch_to_tsquery('portuguese', coalesce(query_text,''))) as rnk
    from filtrado
    where query_text is not null and fts @@ websearch_to_tsquery('portuguese', query_text)
    order by rnk desc limit greatest(match_count*4,30)
  )
  select f.tema, f.subtema, f.tese, f.tribunal, f.processo, f.relator,
         f.orgao_julgador, f.data_julgamento, f.ementa, f.link, f.quando_utilizar,
         (peso_vetor*coalesce(v.sim,0) + peso_fts*coalesce(t.rnk,0)) as score
  from filtrado f
  left join vetor v on v.id = f.id
  left join texto t on t.id = f.id
  where v.id is not null or t.id is not null
  order by score desc
  limit match_count;
$$;

-- ------------------------------------------------------------
-- Observação de segurança:
-- A função buscar_jurisprudencia NUNCA expõe precedente não verificado.
-- Mesmo que o GPT "queira" citar, o banco não devolve o registro.
-- Para publicar um precedente, é preciso UPDATE status_verificacao='VERIFICADO'
-- + verificado_por (exigido pela trigger do schema).
-- ------------------------------------------------------------
