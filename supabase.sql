-- Execute no Supabase: SQL Editor > New query > cole tudo > Run
-- Tabelas (cada linha guarda o registro em JSON) + bucket privado de arquivos.

create table if not exists public.clientes (id text primary key, data jsonb not null);
create table if not exists public.boletos  (id text primary key, data jsonb not null);
create table if not exists public.arquivos (id text primary key, data jsonb not null);
create table if not exists public.chamados (id text primary key, data jsonb not null);
create table if not exists public.config   (id text primary key, data jsonb not null);

-- Segurança: RLS ligado e SEM policies = ninguém acessa pela chave pública (anon).
-- Somente o servidor, com a service_role key, lê e grava.
alter table public.clientes enable row level security;
alter table public.boletos  enable row level security;
alter table public.arquivos enable row level security;
alter table public.chamados enable row level security;
alter table public.config   enable row level security;

-- Bucket privado para boletos/documentos
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;
