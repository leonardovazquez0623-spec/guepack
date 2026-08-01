-- Fase 1: modelo de datos y regla central para pedidos programados.
--
-- IMPORTANTE ANTES DE EJECUTAR:
-- 1. Complete pg_temp.fase1_tenant_operacion con TODOS los tenants existentes.
-- 2. Use exclusivamente slugs confirmados, zonas IANA confirmadas y horarios
--    de apertura aprobados. La migracion falla de forma deliberada si falta
--    cualquier tenant, para no asignar Mexico silenciosamente a otro pais.
-- 3. El tenant principal se identifica por el slug canonico "guepack"; nunca
--    se presupone que su id sea 1.
-- 4. Esta migracion no activa pedidos, no hace backfill de pedidos, no crea
--    rondas y no instala ningun cron.

BEGIN;

-- Evita que cambie el conjunto auditado mientras se comprueban duplicados,
-- se completa la configuracion y se crean las restricciones.
LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.configuracion IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 1. Auditoria fail-closed de configuracion por tenant
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_duplicados TEXT;
BEGIN
  SELECT string_agg(
    format('tenant_id=%s (%s filas)', duplicado.tenant_id, duplicado.total),
    ', ' ORDER BY duplicado.tenant_id
  )
  INTO v_duplicados
  FROM (
    SELECT tenant_id, count(*) AS total
    FROM public.configuracion
    WHERE tenant_id IS NOT NULL
    GROUP BY tenant_id
    HAVING count(*) > 1
  ) AS duplicado;

  IF v_duplicados IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'FASE1_CONFIGURACION_DUPLICADA: no se puede crear UNIQUE (tenant_id)',
      DETAIL = v_duplicados,
      HINT = 'Revise manualmente las filas. Esta migracion no elimina ni combina configuraciones.';
  END IF;
END;
$$;

-- Se agregan primero como NULL para permitir un backfill explicito y
-- verificable dentro de esta misma transaccion.
ALTER TABLE public.tenants
  ADD COLUMN zona_horaria TEXT;

ALTER TABLE public.configuracion
  ADD COLUMN horario_apertura TIME(0) WITHOUT TIME ZONE;

COMMENT ON COLUMN public.tenants.zona_horaria IS
  'Zona horaria IANA del tenant usada para interpretar fechas y horarios civiles.';

COMMENT ON COLUMN public.configuracion.horario_apertura IS
  'Hora local del tenant a partir de la cual pueden activarse sus pedidos del dia.';

-- ---------------------------------------------------------------------------
-- 2. Validacion reusable de zonas horarias IANA
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.zona_horaria_iana_valida(p_zona TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    p_zona IS NOT NULL
    AND p_zona = btrim(p_zona)
    AND p_zona <> ''
    -- Exige un identificador IANA con region, no abreviaturas como CST ni
    -- offsets como UTC-6, -06:00 o GMT+4.
    AND p_zona ~ '^[A-Za-z][A-Za-z0-9._+-]*/[A-Za-z0-9][A-Za-z0-9._+/-]*$'
    -- Rechaza familias de aliases tecnicos/fijos aunque existan en tzdata.
    AND p_zona !~* '^(Etc|SystemV|posix|right)/'
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_timezone_names AS zona
      WHERE zona.name = p_zona
    );
$$;

COMMENT ON FUNCTION public.zona_horaria_iana_valida(TEXT) IS
  'Valida identificadores IANA regionales; rechaza vacios, abreviaturas y offsets fijos.';

CREATE FUNCTION public.validar_zona_horaria_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- NULL solo se tolera durante el backfill de esta migracion. El NOT NULL
  -- aplicado al final impide que llegue a persistirse.
  IF NEW.zona_horaria IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.zona_horaria_iana_valida(NEW.zona_horaria) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ZONA_HORARIA_IANA_INVALIDA',
      DETAIL = format('El valor "%s" no es una zona IANA regional valida.', NEW.zona_horaria),
      HINT = 'Use un nombre presente en pg_timezone_names, por ejemplo America/Mexico_City.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_validar_zona_horaria
BEFORE INSERT OR UPDATE OF zona_horaria
ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.validar_zona_horaria_tenant();

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_zona_horaria_formato_chk
  CHECK (
    zona_horaria IS NULL
    OR (
      zona_horaria = btrim(zona_horaria)
      AND zona_horaria <> ''
    )
  ) NOT VALID;

ALTER TABLE public.configuracion
  ADD CONSTRAINT configuracion_horario_apertura_minuto_chk
  CHECK (
    horario_apertura IS NULL
    OR EXTRACT(SECOND FROM horario_apertura) = 0
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- 3. Mapa explicito y auditable de tenant -> zona -> apertura
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE fase1_tenant_operacion (
  slug TEXT PRIMARY KEY,
  zona_horaria TEXT NOT NULL,
  horario_apertura TIME(0) WITHOUT TIME ZONE NOT NULL
) ON COMMIT DROP;

INSERT INTO fase1_tenant_operacion (
  slug,
  zona_horaria,
  horario_apertura
)
VALUES
  ('guepack', 'America/Mexico_City', '09:00:00');

-- Antes del despliegue agregue aqui, de forma explicita, todos los tenants
-- restantes. Para Bolivia la zona confirmada es America/La_Paz, pero todavia
-- se necesitan los slugs y horarios de apertura confirmados. Ejemplo de forma:
--   , ('slug-bolivia-confirmado', 'America/La_Paz', 'HH:MM:00')

DO $$
DECLARE
  v_principales INTEGER;
  v_sin_mapeo TEXT;
  v_mapeos_inexistentes TEXT;
  v_mapeos_ambiguos TEXT;
  v_zonas_invalidas TEXT;
BEGIN
  SELECT count(*)
  INTO v_principales
  FROM public.tenants
  WHERE slug = 'guepack';

  IF v_principales <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FASE1_TENANT_PRINCIPAL_AMBIGUO',
      DETAIL = format(
        'Se esperaba exactamente un tenant con slug "guepack" y se encontraron %s.',
        v_principales
      ),
      HINT = 'Confirme el slug canonico del tenant principal antes de ejecutar.';
  END IF;

  SELECT string_agg(
    format('%s (id=%s)', tenant.slug, tenant.id),
    ', ' ORDER BY tenant.id
  )
  INTO v_sin_mapeo
  FROM public.tenants AS tenant
  LEFT JOIN fase1_tenant_operacion AS mapa
    ON mapa.slug = tenant.slug
  WHERE mapa.slug IS NULL;

  IF v_sin_mapeo IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FASE1_TENANTS_SIN_CONFIGURACION_CONFIRMADA',
      DETAIL = v_sin_mapeo,
      HINT = 'Agregue cada slug al mapa con su zona IANA y horario confirmados. No use defaults por pais.';
  END IF;

  SELECT string_agg(mapa.slug, ', ' ORDER BY mapa.slug)
  INTO v_mapeos_inexistentes
  FROM fase1_tenant_operacion AS mapa
  LEFT JOIN public.tenants AS tenant
    ON tenant.slug = mapa.slug
  WHERE tenant.id IS NULL;

  IF v_mapeos_inexistentes IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FASE1_MAPEO_CONTIENE_TENANTS_INEXISTENTES',
      DETAIL = v_mapeos_inexistentes,
      HINT = 'Corrija los slugs del mapa antes de ejecutar.';
  END IF;

  SELECT string_agg(
    format('%s (%s tenants)', resolucion.slug, resolucion.total),
    ', ' ORDER BY resolucion.slug
  )
  INTO v_mapeos_ambiguos
  FROM (
    SELECT mapa.slug, count(tenant.id) AS total
    FROM fase1_tenant_operacion AS mapa
    LEFT JOIN public.tenants AS tenant
      ON tenant.slug = mapa.slug
    GROUP BY mapa.slug
    HAVING count(tenant.id) <> 1
  ) AS resolucion;

  IF v_mapeos_ambiguos IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '21000',
      MESSAGE = 'FASE1_MAPEO_DE_TENANTS_AMBIGUO',
      DETAIL = v_mapeos_ambiguos,
      HINT = 'Cada slug del mapa debe resolver exactamente un tenant. Corrija duplicados o use identificadores confirmados.';
  END IF;

  SELECT string_agg(
    format('%s=%s', mapa.slug, mapa.zona_horaria),
    ', ' ORDER BY mapa.slug
  )
  INTO v_zonas_invalidas
  FROM fase1_tenant_operacion AS mapa
  WHERE NOT public.zona_horaria_iana_valida(mapa.zona_horaria);

  IF v_zonas_invalidas IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'FASE1_MAPEO_CONTIENE_ZONAS_INVALIDAS',
      DETAIL = v_zonas_invalidas;
  END IF;
END;
$$;

UPDATE public.tenants AS tenant
SET zona_horaria = mapa.zona_horaria
FROM fase1_tenant_operacion AS mapa
WHERE tenant.slug = mapa.slug;

-- No se crean filas faltantes en configuracion. Aunque el onboarding actual
-- contiene una plantilla, una ausencia en datos existentes puede requerir
-- valores operativos distintos y la migracion no podria revertir con seguridad
-- una fila de negocio creada aqui. La validacion posterior aborta para exigir
-- una correccion explicita.
UPDATE public.configuracion AS configuracion
SET horario_apertura = mapa.horario_apertura
FROM public.tenants AS tenant
INNER JOIN fase1_tenant_operacion AS mapa
  ON mapa.slug = tenant.slug
WHERE configuracion.tenant_id = tenant.id;

-- ---------------------------------------------------------------------------
-- 4. Validacion completa antes de restricciones definitivas
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_tenants_invalidos TEXT;
  v_configuracion_faltante TEXT;
  v_configuracion_huerfana TEXT;
  v_configuracion_sin_horario TEXT;
BEGIN
  SELECT string_agg(
    format('%s (id=%s, zona=%s)', tenant.slug, tenant.id, coalesce(tenant.zona_horaria, 'NULL')),
    ', ' ORDER BY tenant.id
  )
  INTO v_tenants_invalidos
  FROM public.tenants AS tenant
  WHERE NOT coalesce(public.zona_horaria_iana_valida(tenant.zona_horaria), FALSE);

  IF v_tenants_invalidos IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'FASE1_TENANTS_CON_ZONA_INVALIDA_O_FALTANTE',
      DETAIL = v_tenants_invalidos;
  END IF;

  SELECT string_agg(
    format('%s (id=%s)', tenant.slug, tenant.id),
    ', ' ORDER BY tenant.id
  )
  INTO v_configuracion_faltante
  FROM public.tenants AS tenant
  LEFT JOIN public.configuracion AS configuracion
    ON configuracion.tenant_id = tenant.id
  WHERE configuracion.id IS NULL
     OR configuracion.horario_apertura IS NULL;

  IF v_configuracion_faltante IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'FASE1_TENANTS_SIN_HORARIO_APERTURA',
      DETAIL = v_configuracion_faltante;
  END IF;

  SELECT string_agg(
    format(
      'configuracion.id=%s (tenant_id=%s)',
      configuracion.id,
      coalesce(configuracion.tenant_id::TEXT, 'NULL')
    ),
    ', ' ORDER BY configuracion.id
  )
  INTO v_configuracion_huerfana
  FROM public.configuracion AS configuracion
  LEFT JOIN public.tenants AS tenant
    ON tenant.id = configuracion.tenant_id
  WHERE configuracion.tenant_id IS NULL
     OR tenant.id IS NULL;

  IF v_configuracion_huerfana IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'FASE1_CONFIGURACIONES_HUERFANAS',
      DETAIL = v_configuracion_huerfana,
      HINT = 'Corrija manualmente tenant_id; esta migracion no reasigna ni elimina configuraciones.';
  END IF;

  SELECT string_agg(configuracion.id::TEXT, ', ' ORDER BY configuracion.id)
  INTO v_configuracion_sin_horario
  FROM public.configuracion AS configuracion
  WHERE configuracion.horario_apertura IS NULL;

  IF v_configuracion_sin_horario IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'FASE1_CONFIGURACIONES_SIN_HORARIO_APERTURA',
      DETAIL = format('configuracion.id: %s', v_configuracion_sin_horario),
      HINT = 'Complete el mapa explicito; no se aplican horarios por defecto.';
  END IF;
END;
$$;

ALTER TABLE public.tenants
  VALIDATE CONSTRAINT tenants_zona_horaria_formato_chk;

ALTER TABLE public.configuracion
  VALIDATE CONSTRAINT configuracion_horario_apertura_minuto_chk;

ALTER TABLE public.tenants
  ALTER COLUMN zona_horaria SET NOT NULL;

ALTER TABLE public.configuracion
  ALTER COLUMN horario_apertura SET NOT NULL;

ALTER TABLE public.configuracion
  ADD CONSTRAINT configuracion_tenant_id_key UNIQUE (tenant_id);

-- ---------------------------------------------------------------------------
-- 5. Regla pura de evaluacion
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.pedido_evaluar_activacion(
  p_fecha DATE,
  p_metodo_pago TEXT,
  p_pago_verificado BOOLEAN,
  p_horario_apertura TIME(0) WITHOUT TIME ZONE,
  p_zona_horaria TEXT,
  p_ahora TIMESTAMPTZ
)
RETURNS TABLE (
  momento_activacion TIMESTAMPTZ,
  momento_alcanzado BOOLEAN,
  requiere_pago BOOLEAN,
  pago_habilitado BOOLEAN,
  estado_objetivo TEXT,
  debe_encolar_asignacion BOOLEAN,
  motivo TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_metodo TEXT := lower(btrim(coalesce(p_metodo_pago, '')));
  v_momento TIMESTAMPTZ;
  v_requiere_pago BOOLEAN;
  v_pago_habilitado BOOLEAN;
  v_momento_alcanzado BOOLEAN;
BEGIN
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'PEDIDO_FECHA_REQUERIDA';
  END IF;

  IF p_horario_apertura IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'HORARIO_APERTURA_REQUERIDO';
  END IF;

  IF p_ahora IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'MOMENTO_ACTUAL_REQUERIDO';
  END IF;

  IF v_metodo = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'METODO_PAGO_REQUERIDO';
  END IF;

  IF v_metodo NOT IN ('efectivo', 'crédito', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'METODO_PAGO_NO_SOPORTADO',
      DETAIL = p_metodo_pago,
      HINT = 'Actualice la regla central antes de habilitar un nuevo metodo de pago.';
  END IF;

  IF NOT public.zona_horaria_iana_valida(p_zona_horaria) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ZONA_HORARIA_IANA_INVALIDA',
      DETAIL = coalesce(p_zona_horaria, 'NULL');
  END IF;

  -- La suma produce un timestamp civil sin zona. AT TIME ZONE interpreta
  -- ese valor en la zona IANA del tenant y devuelve el instante TIMESTAMPTZ.
  v_momento :=
    (p_fecha + p_horario_apertura)
    AT TIME ZONE p_zona_horaria;

  v_requiere_pago := v_metodo IN ('tarjeta', 'transferencia');
  v_pago_habilitado :=
    NOT v_requiere_pago
    OR p_pago_verificado IS TRUE;
  v_momento_alcanzado := p_ahora >= v_momento;

  IF NOT v_momento_alcanzado THEN
    RETURN QUERY
    SELECT
      v_momento,
      FALSE,
      v_requiere_pago,
      v_pago_habilitado,
      'Programado'::TEXT,
      FALSE,
      'MOMENTO_NO_ALCANZADO'::TEXT;
    RETURN;
  END IF;

  IF NOT v_pago_habilitado THEN
    RETURN QUERY
    SELECT
      v_momento,
      TRUE,
      v_requiere_pago,
      FALSE,
      'Programado'::TEXT,
      FALSE,
      'PAGO_PENDIENTE'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_momento,
    TRUE,
    v_requiere_pago,
    TRUE,
    'Pendiente'::TEXT,
    TRUE,
    'LISTO_PARA_ASIGNACION'::TEXT;
END;
$$;

COMMENT ON FUNCTION public.pedido_evaluar_activacion(
  DATE,
  TEXT,
  BOOLEAN,
  TIME WITHOUT TIME ZONE,
  TEXT,
  TIMESTAMPTZ
) IS
  'Regla pura: calcula el instante de apertura, pago requerido y estado preoperativo objetivo.';

-- ---------------------------------------------------------------------------
-- 6. Transicion atomica e idempotente, sin efectos de asignacion
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.reconciliar_activacion_pedido(
  p_pedido_id BIGINT,
  p_ahora TIMESTAMPTZ DEFAULT statement_timestamp()
)
RETURNS TABLE (
  pedido_id BIGINT,
  estado_anterior TEXT,
  estado_actual TEXT,
  momento_activacion TIMESTAMPTZ,
  momento_alcanzado BOOLEAN,
  pago_habilitado BOOLEAN,
  transicion_realizada BOOLEAN,
  debe_encolar_asignacion BOOLEAN,
  motivo TEXT,
  configuracion_valida BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pedido public.pedidos%ROWTYPE;
  v_zona_horaria TEXT;
  v_horario_apertura TIME(0) WITHOUT TIME ZONE;
  v_tenant_encontrado BOOLEAN := FALSE;
  v_configuracion_encontrada BOOLEAN := FALSE;
  v_estado_preoperativo CONSTANT TEXT[] := ARRAY[
    'Programado',
    'Pendiente',
    'Pendiente pago MP',
    'Pendiente verificación de pago'
  ]::TEXT[];
  v_evaluacion RECORD;
  v_estado_resultante TEXT;
  v_transicion BOOLEAN := FALSE;
BEGIN
  IF p_pedido_id IS NULL THEN
    RETURN QUERY
    SELECT
      NULL::BIGINT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ,
      NULL::BOOLEAN,
      NULL::BOOLEAN,
      FALSE,
      FALSE,
      'PEDIDO_ID_REQUERIDO'::TEXT,
      NULL::BOOLEAN;
    RETURN;
  END IF;

  IF p_ahora IS NULL THEN
    RETURN QUERY
    SELECT
      p_pedido_id,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ,
      NULL::BOOLEAN,
      NULL::BOOLEAN,
      FALSE,
      FALSE,
      'MOMENTO_ACTUAL_REQUERIDO'::TEXT,
      NULL::BOOLEAN;
    RETURN;
  END IF;

  SELECT pedido.*
  INTO v_pedido
  FROM public.pedidos AS pedido
  WHERE pedido.id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      p_pedido_id,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TIMESTAMPTZ,
      NULL::BOOLEAN,
      NULL::BOOLEAN,
      FALSE,
      FALSE,
      'PEDIDO_NO_ENCONTRADO'::TEXT,
      NULL::BOOLEAN;
    RETURN;
  END IF;

  -- Estados operativos/finales y repartidores ya asociados se descartan antes
  -- de tomar locks de configuracion: la regla de activacion no les aplica.
  IF NOT coalesce(v_pedido.estado = ANY(v_estado_preoperativo), FALSE) THEN
    RETURN QUERY
    SELECT
      v_pedido.id::BIGINT,
      v_pedido.estado,
      v_pedido.estado,
      NULL::TIMESTAMPTZ,
      NULL::BOOLEAN,
      NULL::BOOLEAN,
      FALSE,
      FALSE,
      'ESTADO_NO_PREOPERATIVO'::TEXT,
      NULL::BOOLEAN;
    RETURN;
  END IF;

  IF v_pedido.repartidor IS NOT NULL THEN
    RETURN QUERY
    SELECT
      v_pedido.id::BIGINT,
      v_pedido.estado,
      v_pedido.estado,
      NULL::TIMESTAMPTZ,
      NULL::BOOLEAN,
      NULL::BOOLEAN,
      FALSE,
      FALSE,
      'REPARTIDOR_ASIGNADO'::TEXT,
      NULL::BOOLEAN;
    RETURN;
  END IF;

  -- Orden de locks estable: pedido -> tenant -> configuracion. Esto evita
  -- evaluar contra configuracion que cambie a mitad de la reconciliacion.
  SELECT tenant.zona_horaria
  INTO v_zona_horaria
  FROM public.tenants AS tenant
  WHERE tenant.id = v_pedido.tenant_id
  FOR SHARE;

  v_tenant_encontrado := FOUND;

  IF v_tenant_encontrado THEN
    SELECT configuracion.horario_apertura
    INTO v_horario_apertura
    FROM public.configuracion AS configuracion
    WHERE configuracion.tenant_id = v_pedido.tenant_id
    FOR SHARE;

    v_configuracion_encontrada := FOUND;
  END IF;

  IF NOT v_tenant_encontrado
     OR NOT v_configuracion_encontrada
     OR v_zona_horaria IS NULL
     OR v_horario_apertura IS NULL THEN
    RETURN QUERY
    SELECT
      v_pedido.id::BIGINT,
      v_pedido.estado,
      v_pedido.estado,
      NULL::TIMESTAMPTZ,
      NULL::BOOLEAN,
      NULL::BOOLEAN,
      FALSE,
      FALSE,
      'CONFIGURACION_FALTANTE'::TEXT,
      FALSE;
    RETURN;
  END IF;

  IF NOT public.zona_horaria_iana_valida(v_zona_horaria)
     OR EXTRACT(SECOND FROM v_horario_apertura) <> 0 THEN
    RETURN QUERY
    SELECT
      v_pedido.id::BIGINT,
      v_pedido.estado,
      v_pedido.estado,
      NULL::TIMESTAMPTZ,
      NULL::BOOLEAN,
      NULL::BOOLEAN,
      FALSE,
      FALSE,
      'CONFIGURACION_INVALIDA'::TEXT,
      FALSE;
    RETURN;
  END IF;

  SELECT evaluacion.*
  INTO v_evaluacion
  FROM public.pedido_evaluar_activacion(
    v_pedido.fecha,
    v_pedido.metodo_pago,
    v_pedido.pago_verificado,
    v_horario_apertura,
    v_zona_horaria,
    p_ahora
  ) AS evaluacion;

  v_estado_resultante := v_pedido.estado;

  IF v_pedido.estado IS DISTINCT FROM v_evaluacion.estado_objetivo THEN
    UPDATE public.pedidos AS pedido
    SET estado = v_evaluacion.estado_objetivo
    WHERE pedido.id = v_pedido.id
      AND pedido.estado IS NOT DISTINCT FROM v_pedido.estado
      AND pedido.estado = ANY(v_estado_preoperativo)
      AND pedido.repartidor IS NULL
      AND pedido.tenant_id IS NOT DISTINCT FROM v_pedido.tenant_id
      AND pedido.fecha IS NOT DISTINCT FROM v_pedido.fecha
      AND pedido.metodo_pago IS NOT DISTINCT FROM v_pedido.metodo_pago
      AND pedido.pago_verificado IS NOT DISTINCT FROM v_pedido.pago_verificado
    RETURNING pedido.estado
    INTO v_estado_resultante;

    v_transicion := FOUND;

    IF NOT v_transicion THEN
      RETURN QUERY
      SELECT
        v_pedido.id::BIGINT,
        v_pedido.estado,
        v_pedido.estado,
        v_evaluacion.momento_activacion,
        v_evaluacion.momento_alcanzado,
        v_evaluacion.pago_habilitado,
        FALSE,
        FALSE,
        'CONFLICTO_CONCURRENCIA'::TEXT,
        TRUE;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_pedido.id::BIGINT,
    v_pedido.estado,
    v_estado_resultante,
    v_evaluacion.momento_activacion,
    v_evaluacion.momento_alcanzado,
    v_evaluacion.pago_habilitado,
    v_transicion,
    (
      v_transicion
      AND v_estado_resultante = 'Pendiente'
      AND v_evaluacion.debe_encolar_asignacion
    ),
    CASE
      WHEN NOT v_transicion
       AND v_estado_resultante = 'Pendiente'
        THEN 'YA_PENDIENTE'::TEXT
      ELSE v_evaluacion.motivo
    END,
    TRUE;
END;
$$;

COMMENT ON FUNCTION public.reconciliar_activacion_pedido(BIGINT, TIMESTAMPTZ) IS
  'Reconcilia atomica e idempotentemente un pedido preoperativo; no crea rondas ni llama Edge Functions.';

-- ---------------------------------------------------------------------------
-- 7. Superficie de permisos minima
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.zona_horaria_iana_valida(TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.validar_zona_horaria_tenant()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.pedido_evaluar_activacion(
  DATE,
  TEXT,
  BOOLEAN,
  TIME WITHOUT TIME ZONE,
  TEXT,
  TIMESTAMPTZ
)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.reconciliar_activacion_pedido(BIGINT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.zona_horaria_iana_valida(TEXT)
TO service_role;

GRANT EXECUTE ON FUNCTION public.pedido_evaluar_activacion(
  DATE,
  TEXT,
  BOOLEAN,
  TIME WITHOUT TIME ZONE,
  TEXT,
  TIMESTAMPTZ
)
TO service_role;

GRANT EXECUTE ON FUNCTION public.reconciliar_activacion_pedido(BIGINT, TIMESTAMPTZ)
TO service_role;

COMMIT;
