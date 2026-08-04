-- Bloque C: infraestructura ya existente en producción para configurar
-- el horario de apertura por tenant.
--
-- Esta migración es deliberadamente idempotente porque los objetos fueron
-- creados previamente mediante SQL Editor y ahora se formalizan en el
-- historial de migraciones.

BEGIN;

-- Evita inserciones concurrentes mientras se sincroniza la secuencia con
-- los identificadores existentes.
LOCK TABLE public.configuracion IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 1. Secuencia y defaults de public.configuracion
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.configuracion_id_seq;

ALTER SEQUENCE public.configuracion_id_seq
  OWNED BY public.configuracion.id;

-- Coloca la siguiente emisión por encima del id máximo existente.
-- El tercer argumento FALSE hace que el próximo nextval() devuelva
-- exactamente el valor establecido.
SELECT pg_catalog.setval(
  'public.configuracion_id_seq'::regclass,
  GREATEST(
    COALESCE(
      (
        SELECT MAX(configuracion.id)
        FROM public.configuracion AS configuracion
      ),
      0
    ) + 1,
    1
  ),
  FALSE
);

ALTER TABLE public.configuracion
  ALTER COLUMN id
  SET DEFAULT nextval('public.configuracion_id_seq'::regclass);

ALTER TABLE public.configuracion
  ALTER COLUMN tenant_id
  DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 2. Una sola configuración por tenant
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS restriccion
    WHERE restriccion.conrelid = 'public.configuracion'::regclass
      AND restriccion.conname = 'configuracion_tenant_id_key'
      AND restriccion.contype = 'u'
  ) THEN
    ALTER TABLE public.configuracion
      ADD CONSTRAINT configuracion_tenant_id_key
      UNIQUE (tenant_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Zona horaria y horario de apertura
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS zona_horaria TEXT;

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS horario_apertura
  TIME(0) WITHOUT TIME ZONE;

-- ---------------------------------------------------------------------------
-- 4. Validación reusable del horario
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.horario_apertura_valido(p_horario time without time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT p_horario IS NOT NULL AND p_horario >= TIME '00:00:00' AND p_horario < TIME '24:00:00' AND EXTRACT(SECOND FROM p_horario) = 0;
$function$;

-- ---------------------------------------------------------------------------
-- 5. RPC administrativa por tenant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.actualizar_horario_apertura_tenant(p_actor_user_id text, p_tenant_id bigint, p_horario_apertura time without time zone)
 RETURNS TABLE(tenant_id bigint, configuracion_id integer, horario_apertura time without time zone, configuracion_creada boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_membresia_id public.usuario_tenant_roles.id%TYPE;
  v_configuracion_id public.configuracion.id%TYPE;
  v_horario_apertura TIME(0) WITHOUT TIME ZONE;
  v_configuracion_existia BOOLEAN := FALSE;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ACTOR_USER_ID_REQUERIDO';
  END IF;

  IF p_tenant_id IS NULL OR p_tenant_id <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'TENANT_ID_INVALIDO';
  END IF;

  IF NOT public.horario_apertura_valido(p_horario_apertura) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'HORARIO_APERTURA_INVALIDO',
      DETAIL =
        'La hora debe estar entre 00:00 y 23:59, con segundos en cero.';
  END IF;

  SELECT membresia.id
  INTO v_membresia_id
  FROM public.usuario_tenant_roles AS membresia
  WHERE membresia.user_id = pg_catalog.btrim(p_actor_user_id)
    AND membresia.tenant_id = p_tenant_id
    AND membresia.rol = 'admin'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'ACTOR_NO_ES_ADMIN_DEL_TENANT';
  END IF;

  PERFORM 1
  FROM public.tenants AS tenant
  WHERE tenant.id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'TENANT_NO_EXISTE';
  END IF;

  SELECT TRUE
  INTO v_configuracion_existia
  FROM public.configuracion AS configuracion
  WHERE configuracion.tenant_id = p_tenant_id
  FOR UPDATE;

  v_configuracion_existia :=
    COALESCE(v_configuracion_existia, FALSE);

  INSERT INTO public.configuracion AS configuracion (
    tenant_id,
    horario_apertura
  )
  VALUES (
    p_tenant_id,
    p_horario_apertura
  )
  ON CONFLICT ON CONSTRAINT configuracion_tenant_id_key
  DO UPDATE
  SET horario_apertura = EXCLUDED.horario_apertura
  RETURNING
    configuracion.id,
    configuracion.horario_apertura
  INTO
    v_configuracion_id,
    v_horario_apertura;

  RETURN QUERY
  SELECT
    p_tenant_id,
    v_configuracion_id,
    v_horario_apertura,
    NOT v_configuracion_existia;
END;
$function$;

COMMIT;
