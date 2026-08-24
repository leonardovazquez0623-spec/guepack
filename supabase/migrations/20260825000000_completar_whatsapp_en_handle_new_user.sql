-- Cierra el hueco: cuando el alta requiere confirmación de correo, signUp()
-- no entrega sesión y el UPDATE de whatsapp/whatsapp_verificado desde el
-- cliente nunca corre (fix del 24/08 en auth.js). El trigger sí corre
-- siempre porque es SECURITY DEFINER sobre el INSERT en auth.users, así
-- que ahora también toma whatsapp/whatsapp_verificado de los metadatos.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_raw text;
  v_tenant_id bigint;
  v_empresa_codigo text;
  v_empresa_tenants bigint[];
  v_existing_tenant_id bigint;
  v_profile_exists boolean := false;
  v_effective_tenant_id bigint;
  v_conflicting_user_id text;
  v_whatsapp text;
  v_whatsapp_verificado boolean;
begin
  if new.email is null then
    raise exception 'ALTA_TELEFONO_NO_SOPORTADA';
  end if;

  v_tenant_raw :=
    nullif(btrim(new.raw_user_meta_data ->> 'tenant_id'), '');

  v_empresa_codigo :=
    nullif(btrim(new.raw_user_meta_data ->> 'empresa_codigo'), '');

  v_whatsapp :=
    nullif(btrim(new.raw_user_meta_data ->> 'whatsapp'), '');

  v_whatsapp_verificado :=
    coalesce((new.raw_user_meta_data ->> 'whatsapp_verificado')::boolean, false);

  if v_tenant_raw is not null then
    if v_tenant_raw !~ '^[1-9][0-9]*$' then
      raise exception 'TENANT_ID_METADATA_INVALIDO: %', v_tenant_raw;
    end if;

    v_tenant_id := v_tenant_raw::bigint;
  end if;

  if v_empresa_codigo is not null then
    select array_agg(distinct empresa.tenant_id order by empresa.tenant_id)
      into v_empresa_tenants
    from public.empresas_afiliadas as empresa
    where upper(btrim(empresa.codigo)) = upper(v_empresa_codigo)
      and empresa.activa is true
      and empresa.tenant_id is not null;

    if coalesce(cardinality(v_empresa_tenants), 0) <> 1 then
      raise exception
        'EMPRESA_CODIGO_NO_RESUELVE_TENANT_UNICO: %',
        v_empresa_codigo;
    end if;

    if v_tenant_id is null then
      v_tenant_id := v_empresa_tenants[1];
    elsif v_tenant_id <> v_empresa_tenants[1] then
      raise exception
        'EMPRESA_CODIGO_NO_PERTENECE_AL_TENANT: empresa %, tenant %',
        v_empresa_codigo,
        v_tenant_id;
    end if;
  end if;

  if v_tenant_id is not null then
    perform 1
    from public.tenants as tenant
    where tenant.id = v_tenant_id
      and tenant.activo is true;

    if not found then
      raise exception 'TENANT_INEXISTENTE_O_INACTIVO: %', v_tenant_id;
    end if;
  end if;

  select usuario.user_id
    into v_conflicting_user_id
  from public.usuarios as usuario
  where usuario.email = new.email
    and usuario.user_id is distinct from new.id::text
  limit 1;

  if found then
    raise exception 'EMAIL_YA_ASOCIADO_A_OTRO_PERFIL: %', new.email;
  end if;

  select usuario.tenant_id
    into v_existing_tenant_id
  from public.usuarios as usuario
  where usuario.user_id = new.id::text
  for update;

  v_profile_exists := found;

  if v_profile_exists
     and v_existing_tenant_id is not null
     and v_tenant_id is not null
     and v_existing_tenant_id <> v_tenant_id then
    raise exception
      'PERFIL_YA_ASIGNADO_A_OTRO_TENANT: actual %, solicitado %',
      v_existing_tenant_id,
      v_tenant_id;
  end if;

  insert into public.usuarios as perfil (
    email,
    rol,
    user_id,
    empresa_codigo,
    tenant_id,
    whatsapp,
    whatsapp_verificado
  )
  values (
    new.email,
    'cliente',
    new.id::text,
    v_empresa_codigo,
    v_tenant_id,
    v_whatsapp,
    v_whatsapp_verificado
  )
  on conflict (user_id) where user_id is not null
  do update
    set email = excluded.email,
        empresa_codigo = coalesce(
          excluded.empresa_codigo,
          perfil.empresa_codigo
        ),
        tenant_id = coalesce(
          perfil.tenant_id,
          excluded.tenant_id
        ),
        whatsapp = coalesce(excluded.whatsapp, perfil.whatsapp),
        whatsapp_verificado = excluded.whatsapp_verificado or perfil.whatsapp_verificado
  returning perfil.tenant_id
    into v_effective_tenant_id;

  if v_effective_tenant_id is not null then
    insert into public.usuario_tenant_roles (
      user_id,
      tenant_id,
      rol
    )
    values (
      new.id::text,
      v_effective_tenant_id,
      'cliente'
    )
    on conflict (user_id, tenant_id) do nothing;
  end if;

  return new;
end;
$function$;

commit;
