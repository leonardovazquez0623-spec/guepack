-- A2: cierre administrativo atomico e idempotente, sin modificar datos historicos.
BEGIN;
CREATE OR REPLACE FUNCTION public.marcar_entregado(p_pedido_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_repa_id   bigint;
  v_pedido    record;
  v_ya        boolean := false;
  v_total     integer;
  v_meta      integer;
  v_nivel     text;
  v_subio     boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesion requerida';
  END IF;
  v_repa_id := public.mi_repartidor_id();
  SELECT p.id, p.estado, p.tenant_id, p.repartidor_id
    INTO v_pedido
  FROM public.pedidos p WHERE p.id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;
  -- El permiso administrativo usa la misma membresia por tenant que admin.html.
  -- No se aceptan roles globales ni identidades enviadas por el navegador.
  IF NOT EXISTS (
    SELECT 1 FROM public.usuario_tenant_roles r
    WHERE r.user_id = auth.uid()::text
      AND r.tenant_id = v_pedido.tenant_id AND r.rol = 'admin'
  ) AND (v_repa_id IS NULL OR v_pedido.repartidor_id IS DISTINCT FROM v_repa_id) THEN
    RAISE EXCEPTION 'No autorizado para cerrar este pedido';
  END IF;
  -- Se contabiliza al repartidor asignado, nunca al administrador que pulsa.
  v_repa_id := v_pedido.repartidor_id;
  IF v_repa_id IS NOT NULL THEN
    PERFORM 1 FROM public.repartidores r
      WHERE r.id = v_repa_id AND r.tenant_id = v_pedido.tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Repartidor ajeno al tenant del pedido';
    END IF;
  END IF;
  IF v_pedido.estado = 'Entregado' THEN
    v_ya := true;
  ELSE
    UPDATE public.pedidos SET estado = 'Entregado', entregado_at = now() WHERE id = p_pedido_id;
    SELECT c.envios_para_premium INTO v_meta
    FROM public.configuracion c WHERE c.tenant_id = v_pedido.tenant_id LIMIT 1;
    v_meta := COALESCE(v_meta, 25);
    UPDATE public.repartidores
       SET total_envios = COALESCE(total_envios, 0) + 1,
           nivel = CASE
                     WHEN COALESCE(total_envios, 0) + 1 >= v_meta THEN 'premium'
                     ELSE COALESCE(nivel, 'nuevo')
                   END
     WHERE id = v_repa_id
     RETURNING total_envios, nivel INTO v_total, v_nivel;
    v_subio := (v_nivel = 'premium');
  END IF;
  IF v_total IS NULL THEN
    SELECT r.total_envios, r.nivel INTO v_total, v_nivel
    FROM public.repartidores r WHERE r.id = v_repa_id;
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'ya_entregado', v_ya,
    'total_envios', v_total, 'nivel', v_nivel, 'es_premium', v_subio
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_entregado(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_entregado(bigint) TO authenticated;
COMMIT;
