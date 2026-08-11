-- B2.1 — Cerrar la fuga de perfiles y membresías durante el alta.
-- BORRADOR DE REVISIÓN: este archivo está fuera de supabase/migrations y no
-- será ejecutado por `supabase db push`.
--
-- Riesgo aceptado y pendiente: handle_new_user() confía en tenant_id de
-- raw_user_meta_data. Esa metadata la controla el cliente. No es una regresión
-- y solo crea rol cliente, pero la solución definitiva debe derivar el tenant
-- desde una intención de alta firmada o una invitación server-side.

begin;

-- Fuente normalizada para la resolución post-login por Origin.
update public.tenants
set dominio = lower(btrim(dominio))
where dominio is distinct from lower(btrim(dominio));

create unique index if not exists tenants_dominio_lower_uniq
  on public.tenants (lower(dominio))
  where dominio is not null;

-- El default y handle_new_user() cambian dentro de la misma transacción.
-- La columna sigue admitiendo NULL: NULL significa tenant aún no resuelto y
-- no concede acceso mediante mi_tenant_id().
alter table public.usuarios
  alter column tenant_id drop default;

-- Estado auditado el 2026-08-11: user_id NULL = 0 y duplicados = 0.
create unique index if not exists usuarios_user_id_uniq
  on public.usuarios (user_id)
  where user_id is not null;

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
begin
  -- Supabase Phone está desactivado y public.usuarios.email sigue NOT NULL.
  if new.email is null then
    raise exception 'ALTA_TELEFONO_NO_SOPORTADA';
  end if;

  v_tenant_raw :=
    nullif(btrim(new.raw_user_meta_data ->> 'tenant_id'), '');

  v_empresa_codigo :=
    nullif(btrim(new.raw_user_meta_data ->> 'empresa_codigo'), '');

  if v_tenant_raw is not null then
    if v_tenant_raw !~ '^[1-9][0-9]*$' then
      raise exception 'TENANT_ID_METADATA_INVALIDO: %', v_tenant_raw;
    end if;

    v_tenant_id := v_tenant_raw::bigint;
  end if;

  -- empresa_codigo puede resolver el tenant o validar que ambos datos
  -- pertenecen al mismo tenant.
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

  -- Un email no puede reclamar un perfil ligado a otro user_id. Un perfil
  -- precreado con user_id NULL también se rechaza; hoy no existe ninguno.
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
    tenant_id
  )
  values (
    new.email,
    'cliente',
    new.id::text,
    v_empresa_codigo,
    v_tenant_id
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
        )
  returning perfil.tenant_id
    into v_effective_tenant_id;

  -- Perfil y membresía se escriben en la transacción del trigger. Si el
  -- tenant aún no está resuelto —OAuth— no se inventa una membresía.
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

-- Intencionalmente no se revocan permisos de handle_new_user(). La función
-- conserva el ACL actual necesario para el trigger de Auth.

create or replace function public.auto_asignar_rol_cliente(
  p_tenant_id bigint
)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id text := auth.uid()::text;
  v_headers jsonb;
  v_origin text;
  v_origin_host text;
  v_api_host text;
  v_tenants bigint[];
  v_tenant_id bigint;
  v_existing_tenant_id bigint;
  v_es_entorno_local boolean := false;
begin
  if v_user_id is null then
    raise exception 'NO_AUTENTICADO';
  end if;

  v_headers := coalesce(
    nullif(current_setting('request.headers', true), ''),
    '{}'
  )::jsonb;

  v_origin := lower(nullif(btrim(v_headers ->> 'origin'), ''));

  v_api_host := lower(
    coalesce(
      nullif(btrim(v_headers ->> 'x-forwarded-host'), ''),
      nullif(btrim(v_headers ->> 'host'), ''),
      ''
    )
  );

  if v_origin is null
     or v_origin !~ '^https?://[a-z0-9.-]+(:[0-9]+)?$' then
    raise exception 'ORIGIN_AUSENTE_O_INVALIDO';
  end if;

  v_origin_host := regexp_replace(v_origin, '^https?://', '', 'i');
  v_origin_host := regexp_replace(v_origin_host, ':[0-9]+$', '');

  -- La excepción local solo aplica si frontend y API son locales. Un
  -- localhost conectado a Supabase producción será rechazado.
  v_es_entorno_local :=
    v_origin_host in ('localhost', '127.0.0.1')
    and (
      v_api_host in ('localhost', '127.0.0.1')
      or v_api_host like 'localhost:%'
      or v_api_host like '127.0.0.1:%'
    );

  if v_es_entorno_local then
    if p_tenant_id is null then
      raise exception 'TENANT_LOCAL_REQUERIDO';
    end if;

    v_tenant_id := p_tenant_id;

    perform 1
    from public.tenants as tenant
    where tenant.id = v_tenant_id
      and tenant.activo is true;

    if not found then
      raise exception
        'TENANT_LOCAL_INEXISTENTE_O_INACTIVO: %',
        v_tenant_id;
    end if;
  else
    if v_origin_host like 'www.%' then
      v_origin_host := substring(v_origin_host from 5);
    end if;

    select array_agg(tenant.id order by tenant.id)
      into v_tenants
    from public.tenants as tenant
    where tenant.activo is true
      and lower(btrim(tenant.dominio)) = v_origin_host;

    if coalesce(cardinality(v_tenants), 0) <> 1 then
      raise exception
        'ORIGIN_NO_RESUELVE_TENANT_UNICO: %',
        v_origin_host;
    end if;

    v_tenant_id := v_tenants[1];

    if p_tenant_id is distinct from v_tenant_id then
      raise exception
        'TENANT_SOLICITADO_NO_COINCIDE_CON_ORIGIN: solicitado %, origin %',
        p_tenant_id,
        v_tenant_id;
    end if;
  end if;

  select usuario.tenant_id
    into v_existing_tenant_id
  from public.usuarios as usuario
  where usuario.user_id = v_user_id
  for update;

  if not found then
    raise exception 'PERFIL_NO_EXISTE';
  end if;

  if v_existing_tenant_id is not null
     and v_existing_tenant_id <> v_tenant_id then
    raise exception
      'PERFIL_YA_ASIGNADO_A_OTRO_TENANT: actual %, origin %',
      v_existing_tenant_id,
      v_tenant_id;
  end if;

  update public.usuarios
  set tenant_id = v_tenant_id
  where user_id = v_user_id
    and tenant_id is null;

  insert into public.usuario_tenant_roles (
    user_id,
    tenant_id,
    rol
  )
  values (
    v_user_id,
    v_tenant_id,
    'cliente'
  )
  on conflict (user_id, tenant_id) do nothing;

  return json_build_object(
    'success', true,
    'user_id', v_user_id,
    'tenant_id', v_tenant_id,
    'perfil_ya_resuelto', v_existing_tenant_id is not null
  );
end;
$function$;

revoke all
  on function public.auto_asignar_rol_cliente(bigint)
  from public, anon;

grant execute
  on function public.auto_asignar_rol_cliente(bigint)
  to authenticated, service_role;

commit;
