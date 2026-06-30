-- ============================================================
-- GUEPACK — Setup asignación automática server-side
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1. Tabla de cola de rondas pendientes
CREATE TABLE IF NOT EXISTS rondas_pendientes (
  id          SERIAL PRIMARY KEY,
  pedido_id   INTEGER      NOT NULL,
  ronda       INTEGER      NOT NULL,
  ejecutar_en TIMESTAMPTZ  NOT NULL,
  procesado   BOOLEAN      DEFAULT FALSE,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rondas_pendientes_ejecutar
  ON rondas_pendientes (ejecutar_en)
  WHERE procesado = FALSE;

-- 2. Habilitar extensiones necesarias (pg_cron y pg_net)
--    Activarlas en Supabase Dashboard → Database → Extensions si no están activas
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. Cron job: cada minuto procesa rondas vencidas
--    Reemplaza <SERVICE_ROLE_KEY> con la clave real de Supabase → Settings → API
SELECT cron.schedule(
  'guepack-procesar-rondas',
  '* * * * *',
  $$
    WITH pendientes AS (
      UPDATE rondas_pendientes
         SET procesado = TRUE
       WHERE ejecutar_en <= NOW()
         AND procesado = FALSE
      RETURNING pedido_id, ronda
    )
    SELECT net.http_post(
      url     := 'https://zkrnjdsnuyjaxxnluzmn.supabase.co/functions/v1/procesar-asignacion',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inprcm5qZHNudXlqYXh4bmx1em1uIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODc5MTQ2NSwiZXhwIjoyMDk0MzY3NDY1fQ.4Hrzb3dE6p6sipd1ZKk2m27MVYpXH_jpZZM99Vr9VZU>'
      ),
      body    := jsonb_build_object('pedido_id', p.pedido_id, 'ronda', p.ronda)
    )
    FROM pendientes p;
  $$
);

-- Para verificar que el cron quedó registrado:
-- SELECT * FROM cron.job WHERE jobname = 'guepack-procesar-rondas';

-- Para eliminar el cron si necesitas reconfigurarlo:
-- SELECT cron.unschedule('guepack-procesar-rondas');
