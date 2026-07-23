CREATE TABLE IF NOT EXISTS public.webhook_events_procesados (
  event_id TEXT PRIMARY KEY,
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.webhook_events_procesados
  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.webhook_events_procesados IS
  'Eventos de webhook procesados para evitar ejecuciones duplicadas';
