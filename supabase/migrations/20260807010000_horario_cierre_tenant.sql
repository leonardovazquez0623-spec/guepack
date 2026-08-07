-- Hora de cierre configurable por tenant (corte de "ya pasaron las 3 PM").
-- Extiende la infraestructura de Bloque C (horario_apertura) con un
-- segundo horario en la misma fila de configuracion, reutilizando la
-- misma RPC administrada por tenant y el mismo validador genérico.
--
-- La firma y el cuerpo de actualizar_horario_apertura_tenant que se
-- reemplazan aquí fueron confirmados contra producción con
-- pg_get_function_identity_arguments / pg_get_functiondef antes de
-- escribir esta migración — no reconstruidos de memoria.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columna nueva en public.configuracion
-- ---------------------------------------------------------------------------

ALTER TABLE public.configuracion
  ADD COLUMN IF NOT EXISTS horario_cierre
  TIME(0) WITHOUT TIME ZONE;

-- ---------------------------------------------------------------------------
-- 2. Reemplazo de la RPC administrada por tenant: firma extendida con
--    p_horario_cierre (opcional, actualización parcial vía COALESCE).
--    Requiere DROP + CREATE porque el RETURNS TABLE cambia de forma
--    (CREATE OR REPLACE no permite alterar el tipo de retorno).
-- ---------------------------------------------------------------------------

DROP FUNCTION public.actualizar_horario_apertura_tenant(
  p_actor_user_id text,
  p_tenant_id bigint,
  p_horario_apertura time without time zone
);

CREATE FUNCTION public.actualizar_horario_apertura_tenant(
  p_actor_user_id text,
  p_tenant_id bigint,
  p_horario_apertura time without time zone,
  p_horario_cierre time without time zone DEFAULT NULL
)
 RETURNS TABLE(
   tenant_id bigint,
   configuracion_id integer,
   horario_apertura time without time zone,
   horario_cierre time without time zone,
   configuracion_creada boolean
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_membresia_id public.usuario_tenant_roles.id%TYPE;
  v_configuracion_id public.configuracion.id%TYPE;
  v_horario_apertura TIME(0) WITHOUT TIME ZONE;
  v_horario_cierre TIME(0) WITHOUT TIME ZONE;
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

  IF p_horario_cierre IS NOT NULL
     AND NOT public.horario_apertura_valido(p_horario_cierre) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'HORARIO_CIERRE_INVALIDO',
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
    horario_apertura,
    horario_cierre
  )
  VALUES (
    p_tenant_id,
    p_horario_apertura,
    p_horario_cierre
  )
  ON CONFLICT ON CONSTRAINT configuracion_tenant_id_key
  DO UPDATE
  SET horario_apertura = COALESCE(EXCLUDED.horario_apertura, configuracion.horario_apertura),
      horario_cierre   = COALESCE(EXCLUDED.horario_cierre, configuracion.horario_cierre)
  RETURNING
    configuracion.id,
    configuracion.horario_apertura,
    configuracion.horario_cierre
  INTO
    v_configuracion_id,
    v_horario_apertura,
    v_horario_cierre;

  RETURN QUERY
  SELECT
    p_tenant_id,
    v_configuracion_id,
    v_horario_apertura,
    v_horario_cierre,
    NOT v_configuracion_existia;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Permisos: replican el estado real de producción (postgres +
--    service_role únicamente), no el default de PostgreSQL (que otorga
--    EXECUTE a PUBLIC en funciones nuevas). El DROP de la sección 2 borra
--    también los grants que tenía la función vieja, así que hay que
--    reponerlos explícitamente aquí.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.actualizar_horario_apertura_tenant(
  text, bigint, time without time zone, time without time zone
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.actualizar_horario_apertura_tenant(
  text, bigint, time without time zone, time without time zone
) TO service_role;

COMMIT;
