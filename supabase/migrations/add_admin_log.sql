CREATE TABLE IF NOT EXISTS admin_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_email TEXT        NOT NULL,
  accion      TEXT        NOT NULL,
  detalle     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE admin_log ENABLE ROW LEVEL SECURITY;

-- Solo admins pueden leer el log
CREATE POLICY "admin_log_select" ON admin_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE user_id = auth.uid() AND rol = 'admin'
    )
  );

-- Admins autenticados pueden insertar
CREATE POLICY "admin_log_insert" ON admin_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM usuarios
      WHERE user_id = auth.uid() AND rol = 'admin'
    )
  );
