ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS img_bienvenida TEXT,
  ADD COLUMN IF NOT EXISTS img_encamino TEXT,
  ADD COLUMN IF NOT EXISTS img_recolectado TEXT,
  ADD COLUMN IF NOT EXISTS img_transito TEXT,
  ADD COLUMN IF NOT EXISTS img_entregado TEXT,
  ADD COLUMN IF NOT EXISTS img_soporte TEXT;
