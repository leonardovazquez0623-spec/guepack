ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_idempotency_key_unico
  ON public.pedidos (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.pedidos.idempotency_key IS
  'Clave única para evitar la creación duplicada de pedidos';
