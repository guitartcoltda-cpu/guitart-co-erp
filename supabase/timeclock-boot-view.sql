-- Selfies do ponto fora da carga geral (14/10/2026).
-- O app (assets/js/db.js, BOOT_VIEW) passa a ler timeClockEntries por esta view:
-- igual à tabela, mas SEM o campo data.selfieDataUrl (foto em base64, ~60% do
-- peso de cada carga). Em vez da foto, a view traz data.hasSelfie = true.
-- NADA é apagado: a foto continua na tabela; o app a busca só quando alguém abre.
-- Rodar ANTES de publicar o código novo (se a view não existir o app cai para a
-- tabela inteira, mas sem o ganho de tráfego).
create or replace view public."timeClockEntries_boot" as
select
  id,
  case
    when nullif(data->>'selfieDataUrl', '') is not null
      then (data - 'selfieDataUrl') || '{"hasSelfie": true}'::jsonb
    else data - 'selfieDataUrl'
  end as data
from public."timeClockEntries";

grant select on public."timeClockEntries_boot" to anon, authenticated;

-- Cópia de segurança da tabela de ponto antes da mudança (pode ser apagada depois).
create table if not exists public."_backup_timeclock_141026" as
select * from public."timeClockEntries";
alter table public."_backup_timeclock_141026" enable row level security;
