alter table public.envios_nacionales
  add column if not exists tenant_id bigint references public.tenants(id);

-- Backfill: atribuye al tenant correcto los envíos creados antes de esta
-- columna, cruzando por usuarios.user_id (usuarios.user_id es TEXT,
-- envios_nacionales.user_id es UUID — de ahí el cast).
update public.envios_nacionales as e
set tenant_id = u.tenant_id
from public.usuarios as u
where u.user_id = e.user_id::text
  and e.tenant_id is null
  and u.tenant_id is not null;

create index if not exists envios_nacionales_tenant_id_idx
  on public.envios_nacionales (tenant_id);

alter table public.tenants
  add column if not exists comision_guepack_pct numeric not null default 10;

create policy "admin_tenant_ve_envios_nacionales_de_su_tenant"
  on public.envios_nacionales
  for select
  to authenticated
  using (
    (public.is_admin() and tenant_id = public.mi_tenant_id())
    or public.es_superadmin()
  );
