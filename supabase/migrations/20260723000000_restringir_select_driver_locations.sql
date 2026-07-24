DROP POLICY IF EXISTS "public_read_location"
ON public.driver_locations;

DROP POLICY IF EXISTS "clientes leen ubicacion de sus pedidos"
ON public.driver_locations;

DROP POLICY IF EXISTS "administradores leen ubicacion de su tenant"
ON public.driver_locations;

CREATE POLICY "clientes leen ubicacion de sus pedidos"
ON public.driver_locations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedidos AS pedido
    WHERE pedido.id = driver_locations.pedido_id
      AND pedido.user_id = auth.uid()::text
  )
);

CREATE POLICY "administradores leen ubicacion de su tenant"
ON public.driver_locations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pedidos AS pedido
    INNER JOIN public.usuarios AS usuario
      ON usuario.user_id = auth.uid()::text
    WHERE pedido.id = driver_locations.pedido_id
      AND usuario.rol = 'admin'
      AND (
        pedido.tenant_id = usuario.tenant_id
        OR usuario.es_superadmin = TRUE
      )
  )
);
