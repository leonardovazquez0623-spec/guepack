-- Pruebas transaccionales de la Fase 1 de pedidos programados.
--
-- REQUISITOS:
-- 1. Ejecute primero la migracion en una base desechable/staging.
-- 2. Configure guepack.test_pedido_id con el id de un pedido EXCLUSIVO para
--    pruebas. El script modifica temporalmente ese pedido, su tenant y su
--    configuracion, y termina siempre con ROLLBACK.
-- 3. No ejecute este archivo contra produccion: aunque no persiste cambios,
--    toma locks y modifica fixtures dentro de la transaccion.
--
-- Ejemplo previo a la ejecucion en la misma sesion:
--   SET guepack.test_pedido_id = '12345';

BEGIN;

SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Impide que dos ejecuciones de este test muten simultaneamente el fixture.
SELECT pg_catalog.pg_advisory_xact_lock(73129010000);

CREATE TEMP TABLE fase1_test_bootstrap (
  ejecutada BOOLEAN NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.assert_true(
  p_condicion BOOLEAN,
  p_mensaje TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_condicion IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FALLO_TEST_FASE1',
      DETAIL = p_mensaje;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.assert_evaluacion(
  p_caso TEXT,
  p_fecha DATE,
  p_metodo_pago TEXT,
  p_pago_verificado BOOLEAN,
  p_horario_apertura TIME(0) WITHOUT TIME ZONE,
  p_zona_horaria TEXT,
  p_ahora TIMESTAMPTZ,
  p_momento_esperado TIMESTAMPTZ,
  p_alcanzado_esperado BOOLEAN,
  p_requiere_pago_esperado BOOLEAN,
  p_pago_habilitado_esperado BOOLEAN,
  p_estado_esperado TEXT,
  p_encolar_esperado BOOLEAN,
  p_motivo_esperado TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_resultado RECORD;
BEGIN
  SELECT evaluacion.*
  INTO STRICT v_resultado
  FROM public.pedido_evaluar_activacion(
    p_fecha,
    p_metodo_pago,
    p_pago_verificado,
    p_horario_apertura,
    p_zona_horaria,
    p_ahora
  ) AS evaluacion;

  PERFORM pg_temp.assert_true(
    v_resultado.momento_activacion = p_momento_esperado,
    format(
      '%s: momento esperado=%s, recibido=%s',
      p_caso,
      p_momento_esperado,
      v_resultado.momento_activacion
    )
  );
  PERFORM pg_temp.assert_true(
    v_resultado.momento_alcanzado IS NOT DISTINCT FROM p_alcanzado_esperado,
    p_caso || ': momento_alcanzado incorrecto'
  );
  PERFORM pg_temp.assert_true(
    v_resultado.requiere_pago IS NOT DISTINCT FROM p_requiere_pago_esperado,
    p_caso || ': requiere_pago incorrecto'
  );
  PERFORM pg_temp.assert_true(
    v_resultado.pago_habilitado IS NOT DISTINCT FROM p_pago_habilitado_esperado,
    p_caso || ': pago_habilitado incorrecto'
  );
  PERFORM pg_temp.assert_true(
    v_resultado.estado_objetivo = p_estado_esperado,
    p_caso || ': estado_objetivo incorrecto'
  );
  PERFORM pg_temp.assert_true(
    v_resultado.debe_encolar_asignacion IS NOT DISTINCT FROM p_encolar_esperado,
    p_caso || ': debe_encolar_asignacion incorrecto'
  );
  PERFORM pg_temp.assert_true(
    v_resultado.motivo = p_motivo_esperado,
    p_caso || ': motivo incorrecto'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- A. Funcion pura: horarios, zonas y metodos de pago
-- ---------------------------------------------------------------------------

-- America/Mexico_City es UTC-6 en la fecha fija elegida:
-- 2026-07-29 09:00 local = 2026-07-29 15:00Z.
SELECT pg_temp.assert_evaluacion(
  'Mexico antes de las 09:00',
  DATE '2026-07-29',
  'Crédito',
  NULL,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 14:59:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  FALSE,
  FALSE,
  TRUE,
  'Programado',
  FALSE,
  'MOMENTO_NO_ALCANZADO'
);

SELECT pg_temp.assert_evaluacion(
  'Mexico exactamente a las 09:00',
  DATE '2026-07-29',
  'Crédito',
  NULL,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TRUE,
  FALSE,
  TRUE,
  'Pendiente',
  TRUE,
  'LISTO_PARA_ASIGNACION'
);

SELECT pg_temp.assert_evaluacion(
  'Mexico despues de las 09:00',
  DATE '2026-07-29',
  'efectivo',
  FALSE,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 15:01:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TRUE,
  FALSE,
  TRUE,
  'Pendiente',
  TRUE,
  'LISTO_PARA_ASIGNACION'
);

-- America/La_Paz es UTC-4:
-- 2026-07-29 09:00 local = 2026-07-29 13:00Z.
SELECT pg_temp.assert_evaluacion(
  'Bolivia antes de apertura',
  DATE '2026-07-29',
  'Crédito',
  NULL,
  TIME '09:00:00',
  'America/La_Paz',
  TIMESTAMPTZ '2026-07-29 12:59:00+00',
  TIMESTAMPTZ '2026-07-29 13:00:00+00',
  FALSE,
  FALSE,
  TRUE,
  'Programado',
  FALSE,
  'MOMENTO_NO_ALCANZADO'
);

SELECT pg_temp.assert_evaluacion(
  'Bolivia despues de apertura',
  DATE '2026-07-29',
  'Crédito',
  NULL,
  TIME '09:00:00',
  'America/La_Paz',
  TIMESTAMPTZ '2026-07-29 13:01:00+00',
  TIMESTAMPTZ '2026-07-29 13:00:00+00',
  TRUE,
  FALSE,
  TRUE,
  'Pendiente',
  TRUE,
  'LISTO_PARA_ASIGNACION'
);

SELECT pg_temp.assert_evaluacion(
  'Pedido de manana',
  DATE '2026-07-30',
  'Crédito',
  NULL,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 23:00:00+00',
  TIMESTAMPTZ '2026-07-30 15:00:00+00',
  FALSE,
  FALSE,
  TRUE,
  'Programado',
  FALSE,
  'MOMENTO_NO_ALCANZADO'
);

SELECT pg_temp.assert_evaluacion(
  'Tarjeta sin pago',
  DATE '2026-07-29',
  'tarjeta',
  FALSE,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 16:00:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TRUE,
  TRUE,
  FALSE,
  'Programado',
  FALSE,
  'PAGO_PENDIENTE'
);

SELECT pg_temp.assert_evaluacion(
  'Tarjeta pagada',
  DATE '2026-07-29',
  'tarjeta',
  TRUE,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 16:00:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TRUE,
  TRUE,
  TRUE,
  'Pendiente',
  TRUE,
  'LISTO_PARA_ASIGNACION'
);

SELECT pg_temp.assert_evaluacion(
  'Transferencia sin pago',
  DATE '2026-07-29',
  'transferencia',
  NULL,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 16:00:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TRUE,
  TRUE,
  FALSE,
  'Programado',
  FALSE,
  'PAGO_PENDIENTE'
);

SELECT pg_temp.assert_evaluacion(
  'Transferencia aprobada',
  DATE '2026-07-29',
  'transferencia',
  TRUE,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 16:00:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TRUE,
  TRUE,
  TRUE,
  'Pendiente',
  TRUE,
  'LISTO_PARA_ASIGNACION'
);

SELECT pg_temp.assert_evaluacion(
  'Metodo normalizado con espacios y mayusculas',
  DATE '2026-07-29',
  '  TARJETA  ',
  TRUE,
  TIME '09:00:00',
  'America/Mexico_City',
  TIMESTAMPTZ '2026-07-29 16:00:00+00',
  TIMESTAMPTZ '2026-07-29 15:00:00+00',
  TRUE,
  TRUE,
  TRUE,
  'Pendiente',
  TRUE,
  'LISTO_PARA_ASIGNACION'
);

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.pedido_evaluar_activacion(
      DATE '2026-07-29',
      'Crédito',
      TRUE,
      TIME '09:00:00',
      'UTC-6',
      TIMESTAMPTZ '2026-07-29 16:00:00+00'
    );
    RAISE EXCEPTION 'La zona invalida UTC-6 fue aceptada';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL;
  END;
END;
$$;

DO $$
DECLARE
  v_zona TEXT;
BEGIN
  FOREACH v_zona IN ARRAY ARRAY[
    NULL::TEXT,
    '',
    '   ',
    'UTC-6',
    '-06:00',
    'Etc/GMT+6',
    'Etc/Greenwich',
    'SystemV/EST5',
    'Mars/Olympus_Mons',
    'posix/America/Mexico_City'
  ]
  LOOP
    PERFORM pg_temp.assert_true(
      NOT coalesce(public.zona_horaria_iana_valida(v_zona), FALSE),
      format('La zona inválida "%s" fue aceptada', coalesce(v_zona, 'NULL'))
    );
  END LOOP;

  PERFORM pg_temp.assert_true(
    public.zona_horaria_iana_valida('America/Mexico_City')
      AND public.zona_horaria_iana_valida('America/La_Paz'),
    'El validador rechazó una zona regional confirmada'
  );
END;
$$;

DO $$
BEGIN
  BEGIN
    PERFORM *
    FROM public.pedido_evaluar_activacion(
      DATE '2026-07-29',
      NULL,
      TRUE,
      TIME '09:00:00',
      'America/Mexico_City',
      TIMESTAMPTZ '2026-07-29 16:00:00+00'
    );
    RAISE EXCEPTION 'El método NULL fue aceptado';
  EXCEPTION
    WHEN SQLSTATE '22004' THEN
      NULL;
  END;

  BEGIN
    PERFORM *
    FROM public.pedido_evaluar_activacion(
      DATE '2026-07-29',
      'bitcoin',
      TRUE,
      TIME '09:00:00',
      'America/Mexico_City',
      TIMESTAMPTZ '2026-07-29 16:00:00+00'
    );
    RAISE EXCEPTION 'Un método desconocido fue aceptado';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- B. Funcion de transicion: requiere un fixture dedicado
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_id_texto TEXT := current_setting('guepack.test_pedido_id', TRUE);
  v_id BIGINT;
  v_total INTEGER;
BEGIN
  IF v_id_texto IS NULL OR v_id_texto !~ '^[0-9]+$' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FALTA_FIXTURE_FASE1',
      DETAIL = 'Configure guepack.test_pedido_id con un pedido desechable antes de ejecutar.';
  END IF;

  v_id := v_id_texto::BIGINT;

  SELECT count(*)
  INTO v_total
  FROM public.pedidos AS pedido
  INNER JOIN public.tenants AS tenant
    ON tenant.id = pedido.tenant_id
  INNER JOIN public.configuracion AS configuracion
    ON configuracion.tenant_id = tenant.id
  WHERE pedido.id = v_id;

  IF v_total <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'FIXTURE_FASE1_INVALIDO',
      DETAIL = format(
        'El pedido %s debe existir y tener exactamente un tenant y una configuracion.',
        v_id
      );
  END IF;
END;
$$;

CREATE TEMP TABLE resultado_reconciliacion
ON COMMIT DROP
AS
SELECT *
FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 15:00:00+00'
)
WITH NO DATA;

CREATE FUNCTION pg_temp.assert_resultado_unico(p_caso TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_total BIGINT;
BEGIN
  SELECT count(*)
  INTO v_total
  FROM pg_temp.resultado_reconciliacion;

  PERFORM pg_temp.assert_true(
    v_total = 1,
    format('%s: reconciliar debe devolver exactamente una fila; devolvió %s', p_caso, v_total)
  );
END;
$$;

-- Base determinista: tenant Mexico, apertura 09:00 y pedido sin ronda/repartidor.
UPDATE public.tenants AS tenant
SET zona_horaria = 'America/Mexico_City'
FROM public.pedidos AS pedido
WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT
  AND tenant.id = pedido.tenant_id;

UPDATE public.configuracion AS configuracion
SET horario_apertura = TIME '09:00:00'
FROM public.pedidos AS pedido
WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT
  AND configuracion.tenant_id = pedido.tenant_id;

-- Primera activacion y segunda llamada idempotente.
UPDATE public.pedidos
SET
  fecha = DATE '2026-07-29',
  estado = 'Programado',
  metodo_pago = 'Crédito',
  pago_verificado = FALSE,
  repartidor = NULL,
  ronda_asignacion = 0
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT *
FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 15:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('primera activación');

SELECT pg_temp.assert_true(
  estado_anterior = 'Programado'
  AND estado_actual = 'Pendiente'
  AND transicion_realizada
  AND debe_encolar_asignacion
  AND configuracion_valida
  AND motivo = 'LISTO_PARA_ASIGNACION',
  'Primera reconciliacion debio activar y emitir el borde de encolado'
)
FROM resultado_reconciliacion;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT *
FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 15:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('segunda activación idempotente');

SELECT pg_temp.assert_true(
  estado_anterior = 'Pendiente'
  AND estado_actual = 'Pendiente'
  AND NOT transicion_realizada
  AND NOT debe_encolar_asignacion
  AND configuracion_valida
  AND motivo = 'YA_PENDIENTE',
  'La segunda reconciliacion debe ser idempotente y no volver a encolar'
)
FROM resultado_reconciliacion;

-- Un pedido preoperativo de mañana se corrige a Programado.
UPDATE public.pedidos
SET
  fecha = DATE '2026-07-30',
  estado = 'Pendiente',
  metodo_pago = 'Crédito',
  pago_verificado = FALSE,
  repartidor = NULL,
  ronda_asignacion = 0
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT *
FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 23:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('pedido de mañana');

SELECT pg_temp.assert_true(
  estado_anterior = 'Pendiente'
  AND estado_actual = 'Programado'
  AND transicion_realizada
  AND NOT debe_encolar_asignacion
  AND motivo = 'MOMENTO_NO_ALCANZADO',
  'Un pedido de mañana debe quedar Programado'
)
FROM resultado_reconciliacion;

-- Tarjeta no pagada y transferencia no aprobada permanecen Programado.
UPDATE public.pedidos
SET
  fecha = DATE '2026-07-29',
  estado = 'Pendiente pago MP',
  metodo_pago = 'tarjeta',
  pago_verificado = FALSE
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('tarjeta sin pago');

SELECT pg_temp.assert_true(
  estado_actual = 'Programado'
  AND transicion_realizada
  AND NOT debe_encolar_asignacion
  AND NOT pago_habilitado
  AND motivo = 'PAGO_PENDIENTE',
  'Tarjeta sin pago debe continuar Programado'
)
FROM resultado_reconciliacion;

UPDATE public.pedidos
SET
  estado = 'Pendiente verificación de pago',
  metodo_pago = 'transferencia',
  pago_verificado = FALSE
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('transferencia sin pago');

SELECT pg_temp.assert_true(
  estado_actual = 'Programado'
  AND transicion_realizada
  AND NOT debe_encolar_asignacion
  AND NOT pago_habilitado,
  'Transferencia sin aprobar debe continuar Programado'
)
FROM resultado_reconciliacion;

-- La aprobación de transferencia después de apertura activa.
UPDATE public.pedidos
SET pago_verificado = TRUE
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('transferencia aprobada');

SELECT pg_temp.assert_true(
  estado_actual = 'Pendiente'
  AND transicion_realizada
  AND debe_encolar_asignacion
  AND pago_habilitado,
  'Transferencia aprobada después de apertura debe activar'
)
FROM resultado_reconciliacion;

-- Pago confirmado despues de apertura activa.
UPDATE public.pedidos
SET estado = 'Programado', metodo_pago = 'tarjeta', pago_verificado = TRUE
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('tarjeta pagada');

SELECT pg_temp.assert_true(
  estado_actual = 'Pendiente'
  AND transicion_realizada
  AND debe_encolar_asignacion
  AND pago_habilitado,
  'Tarjeta pagada despues de apertura debe activar'
)
FROM resultado_reconciliacion;

-- Estados finales y operativo no se degradan.
UPDATE public.pedidos
SET estado = 'Cancelado', repartidor = NULL, ronda_asignacion = 0
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('pedido cancelado');

SELECT pg_temp.assert_true(
  estado_actual = 'Cancelado'
  AND NOT transicion_realizada
  AND motivo = 'ESTADO_NO_PREOPERATIVO',
  'Cancelado no debe modificarse'
)
FROM resultado_reconciliacion;

UPDATE public.pedidos
SET estado = 'Entregado'
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('pedido entregado');

SELECT pg_temp.assert_true(
  estado_actual = 'Entregado'
  AND NOT transicion_realizada
  AND motivo = 'ESTADO_NO_PREOPERATIVO',
  'Entregado no debe modificarse'
)
FROM resultado_reconciliacion;

UPDATE public.pedidos
SET estado = 'Recolectado'
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('pedido operativo');

SELECT pg_temp.assert_true(
  estado_actual = 'Recolectado'
  AND NOT transicion_realizada
  AND motivo = 'ESTADO_NO_PREOPERATIVO',
  'Estado operativo no debe modificarse'
)
FROM resultado_reconciliacion;

-- Programado con repartidor residual queda bloqueado.
UPDATE public.pedidos
SET
  estado = 'Programado',
  repartidor = '__fixture_repartidor_residual__',
  ronda_asignacion = 0
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('programado con repartidor residual');

SELECT pg_temp.assert_true(
  estado_actual = 'Programado'
  AND NOT transicion_realizada
  AND motivo = 'REPARTIDOR_ASIGNADO',
  'Programado con repartidor residual no debe limpiarse ni activarse'
)
FROM resultado_reconciliacion;

-- Configuracion faltante: no modifica y falla cerrado.
UPDATE public.pedidos
SET estado = 'Programado', repartidor = NULL, ronda_asignacion = 0
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

SAVEPOINT antes_configuracion_faltante;

DELETE FROM public.configuracion AS configuracion
USING public.pedidos AS pedido
WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT
  AND configuracion.tenant_id = pedido.tenant_id;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 16:00:00+00'
);

SELECT pg_temp.assert_resultado_unico('configuración faltante');

SELECT pg_temp.assert_true(
  estado_actual = 'Programado'
  AND NOT transicion_realizada
  AND NOT configuracion_valida
  AND motivo = 'CONFIGURACION_FALTANTE',
  'Configuracion faltante debe bloquear la activacion'
)
FROM resultado_reconciliacion;

ROLLBACK TO SAVEPOINT antes_configuracion_faltante;

-- Cambio de horario antes de activar.
UPDATE public.configuracion AS configuracion
SET horario_apertura = TIME '10:00:00'
FROM public.pedidos AS pedido
WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT
  AND configuracion.tenant_id = pedido.tenant_id;

UPDATE public.pedidos
SET
  fecha = DATE '2026-07-29',
  estado = 'Programado',
  metodo_pago = 'Crédito',
  pago_verificado = FALSE,
  repartidor = NULL,
  ronda_asignacion = 0
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 15:30:00+00'
);

SELECT pg_temp.assert_resultado_unico('horario 10:00 antes de apertura');

SELECT pg_temp.assert_true(
  estado_actual = 'Programado'
  AND motivo = 'MOMENTO_NO_ALCANZADO',
  'Con apertura 10:00 Mexico, 09:30 local aun no activa'
)
FROM resultado_reconciliacion;

UPDATE public.configuracion AS configuracion
SET horario_apertura = TIME '09:00:00'
FROM public.pedidos AS pedido
WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT
  AND configuracion.tenant_id = pedido.tenant_id;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 15:30:00+00'
);

SELECT pg_temp.assert_resultado_unico('horario cambiado a 09:00');

SELECT pg_temp.assert_true(
  estado_actual = 'Pendiente'
  AND transicion_realizada
  AND debe_encolar_asignacion,
  'Al adelantar apertura a 09:00 debe activar en la siguiente reconciliacion'
)
FROM resultado_reconciliacion;

-- Cambio de timezone antes de activar: el mismo instante es 08:30 en Mexico
-- y 10:30 en Bolivia.
UPDATE public.pedidos
SET estado = 'Programado', ronda_asignacion = 0
WHERE id = current_setting('guepack.test_pedido_id')::BIGINT;

UPDATE public.tenants AS tenant
SET zona_horaria = 'America/Mexico_City'
FROM public.pedidos AS pedido
WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT
  AND tenant.id = pedido.tenant_id;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 14:30:00+00'
);

SELECT pg_temp.assert_resultado_unico('timezone México');

SELECT pg_temp.assert_true(
  estado_actual = 'Programado'
  AND motivo = 'MOMENTO_NO_ALCANZADO',
  'A las 14:30Z Mexico todavia no llega a 09:00'
)
FROM resultado_reconciliacion;

UPDATE public.tenants AS tenant
SET zona_horaria = 'America/La_Paz'
FROM public.pedidos AS pedido
WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT
  AND tenant.id = pedido.tenant_id;

TRUNCATE resultado_reconciliacion;
INSERT INTO resultado_reconciliacion
SELECT * FROM public.reconciliar_activacion_pedido(
  current_setting('guepack.test_pedido_id')::BIGINT,
  TIMESTAMPTZ '2026-07-29 14:30:00+00'
);

SELECT pg_temp.assert_resultado_unico('timezone Bolivia');

SELECT pg_temp.assert_true(
  estado_actual = 'Pendiente'
  AND transicion_realizada
  AND debe_encolar_asignacion,
  'A las 14:30Z Bolivia ya paso de 09:00 y debe activar'
)
FROM resultado_reconciliacion;

-- El trigger rechaza offsets manuales.
DO $$
DECLARE
  v_tenant_id BIGINT;
BEGIN
  SELECT pedido.tenant_id
  INTO v_tenant_id
  FROM public.pedidos AS pedido
  WHERE pedido.id = current_setting('guepack.test_pedido_id')::BIGINT;

  BEGIN
    UPDATE public.tenants
    SET zona_horaria = 'UTC-6'
    WHERE id = v_tenant_id;
    RAISE EXCEPTION 'El trigger acepto UTC-6';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL;
  END;
END;
$$;

-- Todo fixture y cambio de prueba se revierte.
ROLLBACK;
