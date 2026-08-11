-- Rollback operativo de B2.1.
-- BORRADOR: restaura default, índices, definiciones y ACL anteriores.
-- No borra perfiles ni membresías creados mientras B2.1 estuvo activo.

begin;

alter table public.usuarios
  alter column tenant_id set default 1;

drop index if exists public.usuarios_user_id_uniq;
drop index if exists public.tenants_dominio_lower_uniq;

CREATE OR REPLACE FUNCTION public.auto_asignar_rol_cliente(p_tenant_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id text := auth.uid()::text;
begin
  if v_user_id is null then
    raise exception 'No autenticado';
  end if;

  insert into public.usuario_tenant_roles (user_id, tenant_id, rol)
  values (v_user_id, p_tenant_id, 'cliente')
  on conflict (user_id, tenant_id) do nothing;

  return json_build_object('success', true);
end;
$function$;

revoke all
  on function public.auto_asignar_rol_cliente(bigint)
  from public, anon;

grant execute
  on function public.auto_asignar_rol_cliente(bigint)
  to postgres, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Si es autenticación por teléfono (verificación OTP), no crear usuario nuevo
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.usuarios (email, rol, user_id, empresa_codigo)
  VALUES (
    NEW.email,
    'cliente',
    NEW.id,
    NEW.raw_user_meta_data->>'empresa_codigo'
  )
  ON CONFLICT (email) DO UPDATE
  SET user_id = NEW.id,
      empresa_codigo = NEW.raw_user_meta_data->>'empresa_codigo';
  RETURN NEW;
END;
$function$;

commit;
