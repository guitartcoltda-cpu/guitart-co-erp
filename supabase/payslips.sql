-- ============================================================
-- Guitart & Co. — tabela "payslips" (Holerites publicados e
-- assinadas eletronicamente) — 14/10/2026
-- ============================================================
-- Como rodar: copie este arquivo inteiro, cole no SQL Editor do
-- Supabase (Project > SQL Editor > New query) e clique em Run.
-- Pode rodar mais de uma vez sem problema (usa "if not exists").
-- Mesmo formato das demais tabelas: id, data (jsonb), created_at,
-- updated_at.
-- ============================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public."payslips" (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists "payslips_data_gin_idx" on public."payslips" using gin (data);
create index if not exists "payslips_updated_at_idx" on public."payslips" (updated_at desc);

drop trigger if exists set_updated_at on public."payslips";
create trigger set_updated_at
before update on public."payslips"
for each row execute function public.set_updated_at();

alter table public."payslips" enable row level security;

drop policy if exists anon_full_access on public."payslips";
create policy anon_full_access on public."payslips"
for all
to anon, authenticated
using (true)
with check (true);
