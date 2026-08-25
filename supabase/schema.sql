-- ============================================================
-- Guitart & Co. — Schema Supabase (Postgres)
-- ============================================================
-- Cada "tabela" do app (assets/js/db.js) vira uma tabela real aqui,
-- mas com o mesmo formato flexível que o app já usa hoje:
--   id (texto), data (jsonb com o registro inteiro), created_at, updated_at
-- Ou seja: não precisamos mapear campo por campo agora (o app já
-- filtra/soma tudo em JavaScript) — isso reduz muito o risco de
-- quebrar alguma tela na migração, e continua sendo um banco de
-- verdade (compartilhado entre todos os dispositivos), diferente do
-- localStorage de hoje. Uma modelagem 100% relacional (colunas
-- tipadas por tabela) pode vir depois, sem pressa, como evolução.
--
-- Como rodar: copie este arquivo inteiro e cole no SQL Editor do
-- Supabase (Project > SQL Editor > New query) e clique em Run.
-- Pode rodar mais de uma vez sem problema (tudo usa "if not exists").
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Função utilitária: mantém updated_at sempre atualizado sozinho
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- Gera automaticamente um CREATE TABLE + índice + trigger + RLS
-- para cada uma das tabelas do sistema.
-- ------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'employees', 'clients', 'costCenters', 'categories', 'services',
    'products', 'stockMovements', 'transactions', 'appointments',
    'bankLines', 'commissionPayouts', 'settings', 'users', 'activityLog',
    'commissionBonuses', 'occurrences', 'cardMachines',
    'productConsumptions', 'notifications', 'approvals', 'chamados'
  ];
begin
  foreach t in array tables loop
    execute format('
      create table if not exists public.%I (
        id text primary key,
        data jsonb not null default ''{}''::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );', t);

    execute format('
      create index if not exists %I on public.%I using gin (data);',
      t || '_data_gin_idx', t);

    execute format('
      drop trigger if exists set_updated_at on public.%I;', t);
    execute format('
      create trigger set_updated_at
      before update on public.%I
      for each row execute function public.set_updated_at();', t);

    -- Habilita RLS em todas as tabelas. Como o login do app continua
    -- sendo o CPF+senha de hoje (não é Supabase Auth de verdade — foi
    -- uma escolha consciente, ver LEIA-ME.md), a política abaixo libera
    -- leitura/escrita para a chave "anon" do projeto, que é a mesma
    -- chave pública embutida no site. Ou seja: a proteção real de quem
    -- acessa o quê continua sendo a tela de login do app (conveniência,
    -- não segurança de verdade), exatamente como já está documentado
    -- hoje para o localStorage. Se no futuro quiser proteção de verdade
    -- por usuário, o caminho é migrar para o Supabase Auth.
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists anon_full_access on public.%I;', t);
    execute format('
      create policy anon_full_access on public.%I
      for all
      to anon, authenticated
      using (true)
      with check (true);', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Usuário administrador padrão (mesmo que o app já cria hoje no
-- primeiro acesso local) — só é inserido se a tabela "users" estiver
-- vazia, para nunca sobrescrever usuários reais já cadastrados.
-- ------------------------------------------------------------
insert into public.users (id, data)
select 'usr_admin001', jsonb_build_object(
  'id', 'usr_admin001',
  'cpf', '00000000000',
  'firstName', 'Administrador',
  'lastName', 'Sistema',
  'password', '123456',
  'role', 'Administrador',
  'active', true,
  'allowedPages', null,
  'createdAt', now(),
  'updatedAt', now()
)
where not exists (select 1 from public.users);

-- ------------------------------------------------------------
-- Configurações padrão (nome da empresa etc.) — idem, só entra se
-- a tabela "settings" estiver vazia.
-- ------------------------------------------------------------
insert into public.settings (id, data)
select 'settings', jsonb_build_object(
  'companyName', 'Guitart & Co.',
  'createdAt', now()
)
where not exists (select 1 from public.settings where id = 'settings');
