BEGIN;

ALTER TABLE public.empresas_afiliadas
  ADD COLUMN IF NOT EXISTS tarifa_receta numeric,
  ADD COLUMN IF NOT EXISTS km_incluidos_receta numeric,
  ADD COLUMN IF NOT EXISTS tarifa_km_receta numeric,
  ADD COLUMN IF NOT EXISTS direccion_farmacia text,
  ADD COLUMN IF NOT EXISTS lat_farmacia double precision,
  ADD COLUMN IF NOT EXISTS lng_farmacia double precision;

COMMENT ON COLUMN public.empresas_afiliadas.tarifa_receta IS
  'Tarifa base (antes de IVA) del servicio con recolección de receta. NULL = la empresa no tiene este servicio habilitado.';
COMMENT ON COLUMN public.empresas_afiliadas.km_incluidos_receta IS
  'Km incluidos en tarifa_receta, medidos farmacia↔domicilio del cliente (no la ruta completa ida+vuelta).';
COMMENT ON COLUMN public.empresas_afiliadas.tarifa_km_receta IS
  'Costo por km excedente sobre km_incluidos_receta.';
COMMENT ON COLUMN public.empresas_afiliadas.direccion_farmacia IS
  'Dirección fija de la farmacia, usada como referencia de distancia y mostrada al repartidor. Solo relevante si tarifa_receta no es NULL.';

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS tipo_servicio text NOT NULL DEFAULT 'directo'
    CHECK (tipo_servicio IN ('directo', 'con_recoleccion')),
  ADD COLUMN IF NOT EXISTS receta_subestado text
    CHECK (receta_subestado IS NULL OR receta_subestado IN (
      'esperando_recoleccion', 'receta_recolectada', 'en_farmacia', 'surtido'
    )),
  ADD COLUMN IF NOT EXISTS receta_llegada_farmacia_at timestamptz,
  ADD COLUMN IF NOT EXISTS receta_surtido_at timestamptz,
  ADD COLUMN IF NOT EXISTS receta_espera_excedida boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pedidos.tipo_servicio IS
  'directo = farmacia→cliente (sin cambios). con_recoleccion = cliente→farmacia→cliente, modelado como pedido single-destino (recolección y entrega son la misma dirección); la farmacia es informativa, no una parada.';
COMMENT ON COLUMN public.pedidos.receta_subestado IS
  'Progreso granular del flujo con_recoleccion. NULL para pedidos directo. pedidos.estado sigue su vocabulario normal (Pendiente→Asignado→...→Entregado) sin cambios; no tocar estadosConocidos en repartidor.html.';

COMMIT;
