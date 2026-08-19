begin;

create or replace function public.rastreo_publico(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_pedido    record;
  v_repa      jsonb := null;
  v_paradas   jsonb := null;
  v_estrellas numeric;
  v_comercio_nombre text;
begin
  if p_token is null or length(trim(p_token)) < 20 or length(p_token) > 100 then
    return jsonb_build_object('encontrado', false);
  end if;

  select p.id, p.estado, p.zona, p.tamanio, p.repartidor, p.tenant_id,
         p.created_at, p.nombre, p.tipo_recoleccion, p.comercio_afiliado_id
    into v_pedido
  from public.pedidos p
  where p.token_rastreo = p_token
  limit 1;

  if not found then
    return jsonb_build_object('encontrado', false);
  end if;

  if v_pedido.comercio_afiliado_id is not null then
    select c.nombre
      into v_comercio_nombre
    from public.comercios_afiliados c
    where c.id = v_pedido.comercio_afiliado_id;
  end if;

  if v_pedido.repartidor is not null then
    select jsonb_build_object(
             'nombre',      r.nombre,
             'foto_perfil', r.foto_perfil,
             'placas',      r.placas,
             'telefono',    r.telefono
           )
      into v_repa
    from public.repartidores r
    where r.nombre = v_pedido.repartidor
      and r.tenant_id = v_pedido.tenant_id
    limit 1;

    select round(avg(c.estrellas)::numeric, 1)
      into v_estrellas
    from public.calificaciones c
    where c.repartidor = v_pedido.repartidor;
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'orden',  s.orden,
             'estado', s.estado,
             'completada', (s.estado = 'completada')
           ) order by s.orden
         )
    into v_paradas
  from public.paradas s
  where s.pedido_id = v_pedido.id;

  return jsonb_build_object(
    'encontrado', true,
    'pedido', jsonb_build_object(
      'folio',            'GK-' || v_pedido.id,
      'estado',           v_pedido.estado,
      'zona',             v_pedido.zona,
      'tamanio',          v_pedido.tamanio,
      'created_at',       v_pedido.created_at,
      'tipo_recoleccion', v_pedido.tipo_recoleccion,
      'comercio_nombre',  v_comercio_nombre
    ),
    'repartidor', v_repa,
    'calificacion', v_estrellas,
    'paradas', coalesce(v_paradas, '[]'::jsonb),
    'total_paradas',      coalesce(jsonb_array_length(v_paradas), 0),
    'paradas_completadas', (
      select count(*) from public.paradas s
      where s.pedido_id = v_pedido.id and s.estado = 'completada'
    )
  );
end;
$$;

commit;
