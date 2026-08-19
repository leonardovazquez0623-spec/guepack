-- Fase 1 comercios afiliados, pasos 2 y 3.
-- Requiere 20260820010000_crear_helpers_autorizacion_tenant.sql.

begin;

create table public.comercios_afiliados (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            bigint not null references public.tenants(id) on delete cascade,
  nombre               text not null,
  giro                 text,
  direccion            text not null,
  referencias          text,
  lat                  double precision not null,
  lng                  double precision not null,
  color_hex            text not null default '#1E56C7',
  logo_url             text,
  acepta_devoluciones  boolean not null default true,
  requiere_factura     boolean not null default true,
  hora_apertura        time,
  hora_cierre          time,
  dias_operacion       smallint[] not null default '{1,2,3,4,5,6}',
  activo               boolean not null default true,
  orden                smallint not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint comercios_color_hex_valido
    check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  constraint comercios_lat_valida check (lat between -90 and 90),
  constraint comercios_lng_valida check (lng between -180 and 180),
  constraint comercios_horario_valido
    check (hora_apertura is null or hora_cierre is null or hora_apertura < hora_cierre)
);

create unique index comercios_afiliados_tenant_nombre_uniq
  on public.comercios_afiliados (tenant_id, lower(nombre));

create index comercios_afiliados_listado_idx
  on public.comercios_afiliados (tenant_id, activo, orden, nombre);

-- Paso 0 confirmó que no había helper de updated_at reutilizable.
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create trigger comercios_afiliados_set_updated_at
before update on public.comercios_afiliados
for each row execute function public.fn_set_updated_at();

alter table public.pedidos
  add column comercio_afiliado_id uuid
    references public.comercios_afiliados(id) on delete set null,
  add column tipo_recoleccion text
    check (tipo_recoleccion in ('recoger', 'devolucion')),
  add column referencia_recoleccion text;

create index pedidos_comercio_afiliado_idx
  on public.pedidos (comercio_afiliado_id)
  where comercio_afiliado_id is not null;

alter table public.precios_generales
  add column cargo_servicio_mostrador numeric not null default 15
    constraint precios_generales_cargo_servicio_mostrador_no_negativo
    check (cargo_servicio_mostrador >= 0);

alter table public.comercios_afiliados enable row level security;

create policy "comercios activos del tenant"
on public.comercios_afiliados
for select
using (
  tenant_id in (select public.mis_tenants())
  and (activo or public.es_admin_de(tenant_id))
);

create policy "admin inserta comercios de su tenant"
on public.comercios_afiliados
for insert
with check (public.es_admin_de(tenant_id));

create policy "admin actualiza comercios de su tenant"
on public.comercios_afiliados
for update
using (public.es_admin_de(tenant_id))
with check (public.es_admin_de(tenant_id));

create policy "admin elimina comercios de su tenant"
on public.comercios_afiliados
for delete
using (public.es_admin_de(tenant_id));

-- La base tiene default privileges amplios para tablas nuevas. El panel usa el
-- cliente autenticado; anon no necesita acceso a esta tabla.
revoke all on table public.comercios_afiliados from anon;
grant select, insert, update, delete on table public.comercios_afiliados
  to authenticated, service_role;

commit;
