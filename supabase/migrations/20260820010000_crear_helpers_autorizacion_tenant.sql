-- Fase 1 comercios afiliados, paso 1.
-- Helpers nuevos: no sustituir is_admin() ni mi_tenant_id() existentes.

begin;

create or replace function public.es_admin_de(p_tenant_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.usuario_tenant_roles as utr
    where utr.user_id = auth.uid()::text
      and utr.tenant_id = p_tenant_id
      and utr.rol = 'admin'
  );
$function$;

create or replace function public.mis_tenants()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select utr.tenant_id
  from public.usuario_tenant_roles as utr
  where utr.user_id = auth.uid()::text
    and utr.tenant_id is not null;
$function$;

revoke execute on function public.es_admin_de(bigint) from public;
revoke execute on function public.mis_tenants() from public;
grant execute on function public.es_admin_de(bigint) to authenticated;
grant execute on function public.mis_tenants() to authenticated;

commit;
