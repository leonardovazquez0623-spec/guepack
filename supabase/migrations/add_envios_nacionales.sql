-- Tabla de caché para tokens de APIs externas (usada por skydropx-auth.ts)
CREATE TABLE IF NOT EXISTS config_app (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE config_app ENABLE ROW LEVEL SECURITY;
-- Sin políticas: solo accesible por service_role (edge functions)

-- Envíos nacionales cotizados vía Skydropx
CREATE TABLE IF NOT EXISTS envios_nacionales (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Origen
  origen_nombre     TEXT,
  origen_telefono   TEXT,
  origen_email      TEXT,
  origen_calle      TEXT,
  origen_numero     TEXT,
  origen_colonia    TEXT,
  origen_ciudad     TEXT,
  origen_estado     TEXT,
  origen_cp         TEXT,
  origen_referencia TEXT,

  -- Destino
  destino_nombre     TEXT,
  destino_telefono   TEXT,
  destino_email      TEXT,
  destino_calle      TEXT,
  destino_numero     TEXT,
  destino_colonia    TEXT,
  destino_ciudad     TEXT,
  destino_estado     TEXT,
  destino_cp         TEXT,
  destino_referencia TEXT,

  -- Paquete
  peso_kg          NUMERIC,
  largo_cm         NUMERIC,
  ancho_cm         NUMERIC,
  alto_cm          NUMERIC,
  contenido        TEXT,
  consignment_note TEXT,

  -- Skydropx
  skydropx_quotation_id TEXT,
  skydropx_rate_id      TEXT,
  skydropx_shipment_id  TEXT,
  paqueteria            TEXT,
  servicio              TEXT,

  -- Extras y pago
  extras           JSONB    NOT NULL DEFAULT '[]',
  costo_envio      NUMERIC,
  costo_extras     NUMERIC  NOT NULL DEFAULT 0,
  costo_total      NUMERIC,
  comprobante_pago TEXT,
  pago_verificado  BOOLEAN  NOT NULL DEFAULT false,

  -- Estado y guía
  estado       TEXT NOT NULL DEFAULT 'pendiente_pago',
  numero_guia  TEXT,
  label_url    TEXT,
  tracking_url TEXT
);

ALTER TABLE envios_nacionales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuarios_ven_sus_envios" ON envios_nacionales
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "usuarios_crean_envios" ON envios_nacionales
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
