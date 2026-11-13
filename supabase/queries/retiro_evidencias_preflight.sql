-- Sólo lectura. Ejecutar ANTES de las dos migraciones en el proyecto elegido.
-- No muestra tokens, teléfonos, claves ni contenidos de archivos.
SELECT table_schema,table_name,column_name,data_type
FROM information_schema.columns
WHERE (table_schema,table_name,column_name) IN (
  ('public','pedidos','user_id'),('public','pedidos','tenant_id'),
  ('public','pedidos','entregado_at'),('public','pedidos','foto_evidencia'),
  ('public','pedidos','firma_evidencia'),('public','pedidos','repartidor_id'),
  ('public','paradas','pedido_id'),('public','paradas','completada_at'),
  ('public','paradas','foto_url'),('public','paradas','firma_url'),
  ('public','repartidores','user_id'),('storage','objects','version'))
ORDER BY table_schema,table_name,column_name;

SELECT id,public,file_size_limit FROM storage.buckets WHERE id IN ('evidencias','evidencias-zips');
SELECT policyname,roles,cmd,permissive,qual,with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects';
SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net','supabase_vault');

SELECT p.tenant_id,
  count(*) FILTER(WHERE p.entregado_at IS NULL) sin_fecha_real,
  count(*) FILTER(WHERE p.entregado_at<=now()-interval '30 days') antiguos_con_fecha,
  count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM public.usuario_tenant_roles r
    WHERE r.user_id=p.user_id AND r.tenant_id=p.tenant_id AND r.rol='cliente')) sin_membresia_cliente
FROM public.pedidos p WHERE p.estado='Entregado' AND (p.foto_evidencia IS NOT NULL OR p.firma_evidencia IS NOT NULL)
GROUP BY p.tenant_id;

SELECT p.tenant_id,
  count(*) FILTER(WHERE s.completada_at IS NULL) paradas_sin_fecha,
  count(*) FILTER(WHERE s.completada_at<=now()-interval '30 days') paradas_antiguas
FROM public.paradas s JOIN public.pedidos p ON p.id=s.pedido_id
WHERE p.estado='Entregado' AND s.estado='completada' AND (s.foto_url IS NOT NULL OR s.firma_url IS NOT NULL)
GROUP BY p.tenant_id;

-- Una referencia con un formato ajeno a los que genera la app requiere
-- revisión antes de activar. No se transforma ni elimina automáticamente.
WITH refs AS (
  SELECT id pedido_id,foto_evidencia valor FROM public.pedidos UNION ALL
  SELECT id,firma_evidencia FROM public.pedidos UNION ALL
  SELECT pedido_id,foto_url FROM public.paradas UNION ALL
  SELECT pedido_id,firma_url FROM public.paradas
)
SELECT count(*) referencias_con_formato_por_revisar FROM refs WHERE valor IS NOT NULL
  AND valor !~ ('(^|/)(evidencias/)?GK-'||pedido_id||'/(foto\.jpg|firma\.png|parada-[0-9]+\.jpg|firma-parada-[0-9]+\.png)(\?.*)?$');
