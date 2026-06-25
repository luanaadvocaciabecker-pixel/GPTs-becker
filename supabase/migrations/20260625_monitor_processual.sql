-- Monitor processual: tabelas + extensões + cron
-- Executado: 2026-06-25

create extension if not exists pg_net  schema extensions;
create extension if not exists pg_cron schema cron;

create table if not exists public.processos_monitorados (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique,
  descricao     text,
  area          text check (area in ('trabalhista','bancario','civel')),
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.movimentacoes_historico (
  id           uuid primary key default gen_random_uuid(),
  processo_id  uuid not null references public.processos_monitorados(id) on delete cascade,
  numero       text not null,
  data_mov     date,
  tipo         text,
  descricao    text,
  hash         text not null,
  detectado_em timestamptz not null default now(),
  unique (processo_id, hash)
);

create table if not exists public.digest_log (
  id           uuid primary key default gen_random_uuid(),
  executado_em timestamptz not null default now(),
  processos    int not null default 0,
  novidades    int not null default 0,
  status       text not null default 'ok',
  detalhe      text
);

create index if not exists idx_mov_processo on public.movimentacoes_historico(processo_id);
create index if not exists idx_mov_hash     on public.movimentacoes_historico(hash);

alter table public.processos_monitorados   enable row level security;
alter table public.movimentacoes_historico  enable row level security;
alter table public.digest_log               enable row level security;

create or replace function public.set_atualizado_em()
returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end;
$$;

create trigger trg_processos_atualizado_em
  before update on public.processos_monitorados
  for each row execute function public.set_atualizado_em();

-- Cron: seg–sex 08h BRT (11h UTC)
select cron.schedule(
  'digest-diario-08h',
  '0 11 * * 1-5',
  $$
  select extensions.http_post(
    url     := 'https://bpzuktssvdosxlxbaeyl.supabase.co/functions/v1/digest-diario',
    body    := '{}',
    headers := '{"Content-Type":"application/json"}'::jsonb
  )
  $$
);
