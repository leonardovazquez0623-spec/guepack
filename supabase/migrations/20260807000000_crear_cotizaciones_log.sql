-- Registro de cotizaciones del comparador nacional, aunque el cliente nunca pague.
-- Da visibilidad en admin de cotizaciones vs. envíos confirmados.

CREATE TABLE IF NOT EXISTS public.cotizaciones_log (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        TEXT NOT NULL,
  quotation_id   TEXT,
  rate_id        TEXT,
  paqueteria     TEXT,
  servicio       TEXT,
  cp_origen      TEXT,
  cp_destino     TEXT,
  costo_cliente  NUMERIC,
  costo_real     NUMERIC,
  ganancia       NUMERIC,
  convertido     BOOLEAN NOT NULL DEFAULT false,
  envio_id       BIGINT REFERENCES public.envios_nacionales(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cotizaciones_log_created_at_idx
  ON public.cotizaciones_log (created_at DESC);

CREATE INDEX IF NOT EXISTS cotizaciones_log_user_quotation_rate_idx
  ON public.cotizaciones_log (user_id, quotation_id, rate_id, created_at DESC);

ALTER TABLE public.cotizaciones_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cotizaciones_log FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.cotizaciones_log TO authenticated;
GRANT SELECT ON TABLE public.cotizaciones_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cotizaciones_log_id_seq TO authenticated;

-- El marcado convertido=true / envio_id lo hace skydropx-confirmar-envio con
-- su cliente service_role, que ya bypassea RLS. No se abre UPDATE al cliente.

DROP POLICY IF EXISTS "usuarios insertan sus propias cotizaciones" ON public.cotizaciones_log;
CREATE POLICY "usuarios insertan sus propias cotizaciones"
  ON public.cotizaciones_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "admins ven todas las cotizaciones" ON public.cotizaciones_log;
CREATE POLICY "admins ven todas las cotizaciones"
  ON public.cotizaciones_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.usuarios AS administrador
      WHERE administrador.user_id::text = auth.uid()::text
        AND (administrador.rol = 'admin' OR administrador.es_superadmin IS TRUE)
    )
  );
