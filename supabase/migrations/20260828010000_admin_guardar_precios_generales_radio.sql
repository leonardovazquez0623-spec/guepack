CREATE OR REPLACE FUNCTION public.admin_guardar_precios_generales(p_tenant_id bigint, p_tarifa_base numeric, p_km_minimo numeric, p_precio_km_extra numeric, p_iva numeric, p_cargo_paquete_grande numeric, p_rangos jsonb, p_radio_maximo_km numeric default null)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing_id bigint;
  v_rango jsonb;
begin
  if not (public.is_admin() and p_tenant_id = public.mi_tenant_id()) then
    raise exception 'No tienes permisos de admin sobre el tenant %', p_tenant_id;
  end if;

  if p_cargo_paquete_grande < 0 then
    raise exception 'El cargo de paquete grande debe ser mayor o igual a cero';
  end if;

  if p_radio_maximo_km is not null and p_radio_maximo_km <= 0 then
    raise exception 'radio_maximo_km debe ser mayor a cero';
  end if;

  if jsonb_array_length(p_rangos) = 0 then
    raise exception 'Debes incluir al menos un rango de precio';
  end if;

  select id into v_existing_id from public.precios_generales where tenant_id = p_tenant_id limit 1;

  if v_existing_id is not null then
    update public.precios_generales
    set tarifa_base = p_tarifa_base,
        km_minimo = p_km_minimo,
        precio_km_extra = p_precio_km_extra,
        iva = p_iva,
        cargo_paquete_grande = p_cargo_paquete_grande,
        radio_maximo_km = p_radio_maximo_km
    where id = v_existing_id;
  else
    insert into public.precios_generales (tenant_id, tarifa_base, km_minimo, precio_km_extra, iva, cargo_paquete_grande, radio_maximo_km)
    values (p_tenant_id, p_tarifa_base, p_km_minimo, p_precio_km_extra, p_iva, p_cargo_paquete_grande, p_radio_maximo_km);
  end if;

  delete from public.rangos_precio_general where tenant_id = p_tenant_id;

  for v_rango in select * from jsonb_array_elements(p_rangos)
  loop
    if (v_rango->>'km_desde') is null or (v_rango->>'precio') is null or (v_rango->>'precio')::numeric <= 0 then
      raise exception 'Verifica que todos los rangos tengan Desde y Precio válidos';
    end if;
    insert into public.rangos_precio_general (tenant_id, km_desde, km_hasta, precio)
    values (
      p_tenant_id,
      (v_rango->>'km_desde')::numeric,
      nullif(v_rango->>'km_hasta','')::numeric,
      (v_rango->>'precio')::numeric
    );
  end loop;

  return json_build_object('success', true);
end;
$function$
