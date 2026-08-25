create or replace function public.validar_codigo_empresa(p_codigo text, p_tenant_id bigint)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.empresas_afiliadas
    where upper(btrim(codigo)) = upper(btrim(p_codigo))
      and activa is true
      and tenant_id = p_tenant_id
  );
$$;

revoke all on function public.validar_codigo_empresa(text, bigint) from public;
grant execute on function public.validar_codigo_empresa(text, bigint) to anon, authenticated;
