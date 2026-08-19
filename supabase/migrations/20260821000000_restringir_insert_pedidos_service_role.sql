-- Cierra el INSERT directo a pedidos desde el navegador.
--
-- Único insert vivo que dependía de la política "insert pedidos
-- autenticados" (auth.uid() IS NOT NULL): _aplicarCargoCancelacion() en
-- app.html, para clientes corporativos. Se reemplaza aquí por una RPC
-- security definer que resuelve tenant_id desde usuarios.tenant_id (B2.1),
-- nunca desde el default de la columna pedidos.tenant_id (hoy fijo en 1).
--
-- Auditoría de alcance antes de aplicar (production, 2026-08-19):
--   select tenant_id, count(*) from pedidos group by tenant_id;
--   → 288 filas, todas tenant_id = 1. Sin contaminación cruzada de
--     tenants que reconciliar.
--   column_default de pedidos.tenant_id sigue en 1 — no se toca aquí; el
--   riesgo se mitiga resolviendo el tenant explícitamente en la RPC.
--
-- widget.html también intenta un insert directo a pedidos, sin sesión
-- (anon puro, sin login). Ya está bloqueado hoy por esta misma política
-- (auth.uid() es NULL sin sesión) — este cambio no altera ni repara ese
-- comportamiento. Queda fuera de alcance, señalado aparte.
--
-- app.html:4149 (el `else` con insert directo del camino esCaminoPrecioGeneral
-- legado) sigue siendo código muerto — las 5 ramas esCamino* son exhaustivas
-- y ese bloque nunca se alcanza. No se toca en esta migración.
--
-- pedidos.token_rastreo ya tiene DEFAULT gen_random_uuid()::text desde
-- 20260803010000_rastreo_publico_rpc.sql (ya aplicada) — no hace falta
-- tocarlo aquí; el RPC nuevo simplemente no lo manda.

begin;

create or replace function public.registrar_cargo_cancelacion_corporativo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id text := auth.uid()::text;
  v_usuario public.usuarios%rowtype;
  v_pedido  public.pedidos%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'NO_AUTENTICADO';
  end if;

  select *
    into v_usuario
  from public.usuarios
  where user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'PERFIL_USUARIO_NO_ENCONTRADO';
  end if;
  if v_usuario.tenant_id is null then
    raise exception using errcode = 'P0001', message = 'TENANT_NO_RESUELTO';
  end if;
  if v_usuario.empresa_codigo is null or btrim(v_usuario.empresa_codigo) = '' then
    raise exception using errcode = 'P0001', message = 'FLUJO_NO_CORPORATIVO';
  end if;

  insert into public.pedidos (
    nombre, precio, metodo_pago, empresa_codigo, estado, user_id, tenant_id, fecha
  )
  values (
    'Cargo cancelación', 25, 'Crédito', v_usuario.empresa_codigo, 'Cancelado',
    v_user_id, v_usuario.tenant_id, (now() at time zone 'utc')::date
  )
  returning * into v_pedido;

  return jsonb_build_object('id', v_pedido.id);
end;
$$;

comment on function public.registrar_cargo_cancelacion_corporativo() is
  'Registra el cargo de cancelación ($25) de un cliente corporativo como fila de pedidos, resolviendo tenant_id desde usuarios.tenant_id (nunca desde el default de la columna). Reemplaza el insert directo de _aplicarCargoCancelacion() en app.html.';

revoke all on function public.registrar_cargo_cancelacion_corporativo() from public, anon;
grant execute on function public.registrar_cargo_cancelacion_corporativo() to authenticated;

drop policy if exists "insert pedidos autenticados" on public.pedidos;

commit;
