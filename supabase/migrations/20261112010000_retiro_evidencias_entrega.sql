BEGIN;

-- No se inventan fechas históricas: entregado_at NULL conserva los archivos.
ALTER TABLE public.pedidos ADD COLUMN evidencias_retiradas_at timestamptz;
ALTER TABLE public.paradas ADD COLUMN evidencias_retiradas_at timestamptz;

CREATE TABLE public.evidencia_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  tenant_id bigint NOT NULL REFERENCES public.tenants(id),
  clave uuid NOT NULL,
  estado text NOT NULL DEFAULT 'preparando'
    CHECK (estado IN ('preparando','verificado','listo','expirando','expirado')),
  creado_at timestamptz NOT NULL DEFAULT now(),
  verificado_at timestamptz,
  vence_at timestamptz,
  zip_ruta text,
  zip_sha256 text,
  zip_bytes bigint,
  lease uuid,
  lease_hasta timestamptz,
  intentado_at timestamptz,
  ultimo_error text,
  UNIQUE (user_id, tenant_id, clave)
);
CREATE UNIQUE INDEX evidencia_lote_en_curso ON public.evidencia_lotes(user_id, tenant_id)
  WHERE estado IN ('preparando','verificado');

CREATE TABLE public.evidencia_archivos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lote_id uuid NOT NULL REFERENCES public.evidencia_lotes(id),
  ruta text NOT NULL,
  objeto_id uuid NOT NULL,
  objeto_version text,
  bytes bigint NOT NULL,
  estado text NOT NULL DEFAULT 'reservado'
    CHECK (estado IN ('reservado','borrando','eliminado','compartido','conservado')),
  UNIQUE (lote_id, ruta)
);
CREATE UNIQUE INDEX evidencia_archivo_reservado ON public.evidencia_archivos(ruta)
  WHERE estado IN ('reservado','borrando','eliminado');
CREATE TABLE public.evidencia_lote_refs (
  archivo_id bigint NOT NULL REFERENCES public.evidencia_archivos(id),
  tabla text NOT NULL CHECK (tabla IN ('pedidos','paradas')),
  registro_id bigint NOT NULL,
  pedido_id bigint NOT NULL,
  campo text NOT NULL CHECK (campo IN ('foto_evidencia','firma_evidencia','foto_url','firma_url')),
  valor text NOT NULL,
  PRIMARY KEY (archivo_id, tabla, registro_id, campo)
);
ALTER TABLE public.evidencia_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidencia_archivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidencia_lote_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evidencia_lotes, public.evidencia_archivos, public.evidencia_lote_refs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.evidencia_lotes, public.evidencia_archivos, public.evidencia_lote_refs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.evidencia_archivos_id_seq TO service_role;

CREATE FUNCTION public.evidencia_ruta(p_valor text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text; b bytea := ''::bytea; i integer := 1;
BEGIN
  IF p_valor IS NULL THEN RETURN NULL; END IF;
  v := split_part(btrim(p_valor), '?', 1);
  IF v ~ '^https?://' THEN
    IF v !~ '/storage/v1/object/(public|sign|authenticated)/evidencias/' THEN RETURN NULL; END IF;
    v := regexp_replace(v, '^.*?/storage/v1/object/(public|sign|authenticated)/evidencias/', '');
  ELSE
    v := regexp_replace(v, '^/?evidencias/', '');
  END IF;
  WHILE i <= length(v) LOOP
    IF substr(v,i,1) = '%' THEN
      b := b || decode(substr(v,i+1,2), 'hex'); i := i+3;
    ELSE
      b := b || convert_to(substr(v,i,1), 'UTF8'); i := i+1;
    END IF;
  END LOOP;
  v := convert_from(b,'UTF8');
  IF v !~ '^(GK-[0-9]+/|comprobantes/|depositos/)' OR v ~ '(^|/)\.\.(/|$)' THEN RETURN NULL; END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- Incluye todas las columnas de ambos registros para detectar un archivo
-- reutilizado como recolección, receta, comprobante u otra referencia.
CREATE VIEW public.evidencia_referencias AS
SELECT 'pedidos'::text tabla, p.id registro_id, p.id pedido_id, p.user_id::text user_id,
  p.tenant_id, e.key campo, e.value valor, public.evidencia_ruta(e.value) ruta,
  p.entregado_at fecha_entrega,
  (p.estado = 'Entregado' AND e.key IN ('foto_evidencia','firma_evidencia')) entrega
FROM public.pedidos p CROSS JOIN LATERAL jsonb_each_text(to_jsonb(p)) e
WHERE public.evidencia_ruta(e.value) IS NOT NULL
UNION ALL
SELECT 'paradas', s.id, p.id, p.user_id::text, p.tenant_id, e.key, e.value,
  public.evidencia_ruta(e.value), s.completada_at,
  (p.estado = 'Entregado' AND s.estado = 'completada' AND e.key IN ('foto_url','firma_url'))
FROM public.paradas s JOIN public.pedidos p ON p.id = s.pedido_id
CROSS JOIN LATERAL jsonb_each_text(to_jsonb(s)) e
WHERE public.evidencia_ruta(e.value) IS NOT NULL;
REVOKE ALL ON public.evidencia_referencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evidencia_referencias TO service_role;

CREATE FUNCTION public.evidencia_es_cliente(p_user text, p_tenant bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.usuario_tenant_roles r JOIN public.tenants t ON t.id=r.tenant_id
    WHERE r.user_id=p_user AND r.tenant_id=p_tenant AND r.rol='cliente' AND t.activo);
$$;

CREATE FUNCTION public.evidencia_elegibles(p_user text, p_tenant bigint)
RETURNS SETOF public.evidencia_referencias
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.* FROM public.evidencia_referencias r
  WHERE r.user_id=p_user AND r.tenant_id=p_tenant AND r.entrega
    AND r.fecha_entrega <= now()-interval '30 days'
    AND r.ruta LIKE 'GK-' || r.pedido_id || '/%'
    AND r.ruta ~ '^GK-[0-9]+/(foto\.jpg|firma\.png|parada-[0-9]+\.jpg|firma-parada-[0-9]+\.png)$'
    AND EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidencias' AND o.name=r.ruta)
    AND NOT EXISTS (SELECT 1 FROM public.evidencia_archivos a WHERE a.ruta=r.ruta
      AND a.estado IN ('reservado','borrando','eliminado'));
$$;

CREATE FUNCTION public.evidencia_resumen(p_tenant bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user text := auth.uid()::text; v_result jsonb;
BEGIN
  IF v_user IS NULL OR NOT public.evidencia_es_cliente(v_user,p_tenant) THEN
    RAISE EXCEPTION 'SESION_CLIENTE_TENANT_INVALIDA' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object('elegibles', (SELECT count(*) FROM public.evidencia_elegibles(v_user,p_tenant)),
    'lotes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'estado',estado,'vence_at',vence_at,'error',ultimo_error) ORDER BY creado_at DESC)
      FROM public.evidencia_lotes WHERE user_id=v_user AND tenant_id=p_tenant
        AND estado NOT IN ('expirado','expirando') AND (vence_at IS NULL OR vence_at>now())), '[]'::jsonb)) INTO v_result;
  RETURN v_result;
END $$;

-- Sólo Edge tras Auth.getUser puede registrar consentimiento. No se expone
-- una RPC de escritura que permita saltarse la validación de sesión en Auth.
CREATE FUNCTION public.evidencia_iniciar(p_tenant bigint, p_clave uuid, p_user text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user text := p_user; v_lote uuid; r record; obj record; v_id bigint;
  v_total bigint := 0; v_cantidad integer := 0;
BEGIN
  IF v_user IS NULL OR p_clave IS NULL OR NOT public.evidencia_es_cliente(v_user,p_tenant) THEN
    RAISE EXCEPTION 'SESION_CLIENTE_TENANT_INVALIDA' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evidencia-cliente:'||v_user||':'||p_tenant,0));
  SELECT id INTO v_lote FROM public.evidencia_lotes WHERE user_id=v_user AND tenant_id=p_tenant AND clave=p_clave;
  IF FOUND THEN RETURN v_lote; END IF;
  SELECT id INTO v_lote FROM public.evidencia_lotes WHERE user_id=v_user AND tenant_id=p_tenant AND estado IN ('preparando','verificado');
  IF FOUND THEN RETURN v_lote; END IF;
  INSERT INTO public.evidencia_lotes(user_id,tenant_id,clave) VALUES(v_user,p_tenant,p_clave) RETURNING id INTO v_lote;
  -- Lotes acotados evitan exceder disco/tiempo de Edge. La UI ofrece el siguiente.
  FOR r IN SELECT DISTINCT e.ruta FROM public.evidencia_elegibles(v_user,p_tenant) e ORDER BY e.ruta LOOP
    -- La reserva debe observar el mismo dueño, tenant y fecha que el snapshot,
    -- también cuando la evidencia sólo está en una parada del pedido.
    PERFORM 1 FROM public.pedidos p WHERE p.id IN
      (SELECT e.pedido_id FROM public.evidencia_elegibles(v_user,p_tenant) e WHERE e.ruta=r.ruta)
      ORDER BY p.id FOR UPDATE;
    PERFORM 1 FROM public.paradas s WHERE s.id IN
      (SELECT e.registro_id FROM public.evidencia_elegibles(v_user,p_tenant) e WHERE e.ruta=r.ruta AND e.tabla='paradas')
      ORDER BY s.id FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended('evidencia:'||r.ruta,0));
    IF NOT EXISTS (SELECT 1 FROM public.evidencia_elegibles(v_user,p_tenant) e WHERE e.ruta=r.ruta) THEN CONTINUE; END IF;
    SELECT COALESCE((o.metadata->>'size')::bigint,0) bytes, o.id, o.version INTO obj
      FROM storage.objects o WHERE o.bucket_id='evidencias' AND o.name=r.ruta;
    IF obj.bytes <= 0 THEN RAISE EXCEPTION 'TAMANO_EVIDENCIA_DESCONOCIDO'; END IF;
    IF v_cantidad>0 AND (v_total+obj.bytes>104857600 OR v_cantidad>=100) THEN EXIT; END IF;
    IF obj.bytes>104857600 THEN RAISE EXCEPTION 'EVIDENCIA_SUPERA_100_MIB'; END IF;
    INSERT INTO public.evidencia_archivos(lote_id,ruta,objeto_id,objeto_version,bytes)
      VALUES(v_lote,r.ruta,obj.id,obj.version,obj.bytes) RETURNING id INTO v_id;
    INSERT INTO public.evidencia_lote_refs(archivo_id,tabla,registro_id,pedido_id,campo,valor)
      SELECT v_id,e.tabla,e.registro_id,e.pedido_id,e.campo,e.valor FROM public.evidencia_referencias e
      JOIN public.evidencia_archivos a ON a.id=v_id AND a.ruta=e.ruta
      WHERE e.user_id=v_user AND e.tenant_id=p_tenant AND e.entrega
        AND e.fecha_entrega<=now()-interval '30 days' AND e.ruta LIKE 'GK-'||e.pedido_id||'/%';
    v_total := v_total+obj.bytes; v_cantidad := v_cantidad+1;
  END LOOP;
  IF v_cantidad=0 THEN DELETE FROM public.evidencia_lotes WHERE id=v_lote; RETURN NULL; END IF;
  RETURN v_lote;
END $$;

-- Serializa cambios de referencias con la reserva. El estado borrando es
-- persistente: un timeout después de Storage.remove se puede reconciliar.
CREATE FUNCTION public.evidencia_guardar_referencias() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old jsonb := CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  r record;
BEGIN
  FOR r IN SELECT DISTINCT public.evidencia_ruta(value) ruta
    FROM (SELECT value FROM jsonb_each_text(v_old) UNION SELECT value FROM jsonb_each_text(v_new)) e
    WHERE public.evidencia_ruta(value) IS NOT NULL ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('evidencia:'||r.ruta,0));
  END LOOP;
  IF TG_TABLE_NAME='pedidos' AND EXISTS (SELECT 1 FROM public.evidencia_lote_refs ref JOIN public.evidencia_archivos a ON a.id=ref.archivo_id
    WHERE ref.pedido_id=(v_old->>'id')::bigint AND a.estado IN ('reservado','borrando')
      AND (TG_OP='DELETE' OR v_old->'user_id' IS DISTINCT FROM v_new->'user_id'
        OR v_old->'tenant_id' IS DISTINCT FROM v_new->'tenant_id' OR v_old->'estado' IS DISTINCT FROM v_new->'estado'
        OR v_old->'entregado_at' IS DISTINCT FROM v_new->'entregado_at')) THEN RAISE EXCEPTION 'EVIDENCIA_EN_PREPARACION'; END IF;
  IF EXISTS (SELECT 1 FROM public.evidencia_lote_refs ref JOIN public.evidencia_archivos a ON a.id=ref.archivo_id
      WHERE ref.tabla=TG_TABLE_NAME AND ref.registro_id=(v_old->>'id')::bigint AND a.estado IN ('reservado','borrando')
      AND (v_old->ref.campo IS DISTINCT FROM v_new->ref.campo OR TG_OP='DELETE'
        OR v_old->'user_id' IS DISTINCT FROM v_new->'user_id' OR v_old->'tenant_id' IS DISTINCT FROM v_new->'tenant_id'
        OR v_old->'pedido_id' IS DISTINCT FROM v_new->'pedido_id' OR v_old->'estado' IS DISTINCT FROM v_new->'estado'
        OR v_old->'entregado_at' IS DISTINCT FROM v_new->'entregado_at' OR v_old->'completada_at' IS DISTINCT FROM v_new->'completada_at')) THEN
    RAISE EXCEPTION 'EVIDENCIA_EN_PREPARACION';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each_text(v_new) e JOIN public.evidencia_archivos a ON a.ruta=public.evidencia_ruta(e.value)
    WHERE (v_old->>e.key IS DISTINCT FROM e.value) AND a.estado IN ('reservado','borrando','eliminado')) THEN
    RAISE EXCEPTION 'EVIDENCIA_RESERVADA_O_RETIRADA';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER evidencia_guardar_pedido BEFORE INSERT OR UPDATE OR DELETE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.evidencia_guardar_referencias();
CREATE TRIGGER evidencia_guardar_parada BEFORE INSERT OR UPDATE OR DELETE ON public.paradas
  FOR EACH ROW EXECUTE FUNCTION public.evidencia_guardar_referencias();

CREATE FUNCTION public.evidencia_reclamar(p_lote uuid, p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.evidencia_lotes;
BEGIN
  SELECT * INTO l FROM public.evidencia_lotes WHERE id=p_lote FOR UPDATE;
  IF NOT FOUND OR l.estado IN ('expirado','expirando') OR (l.lease_hasta>now() AND l.lease<>p_lease) THEN RETURN NULL; END IF;
  IF NOT public.evidencia_es_cliente(l.user_id,l.tenant_id) THEN RETURN NULL; END IF;
  IF COALESCE(l.vence_at,l.creado_at+interval '24 hours')<=now() THEN RETURN NULL; END IF;
  -- Más largo que la vida máxima de un worker Edge y sus peticiones pendientes.
  UPDATE public.evidencia_lotes SET lease=p_lease,lease_hasta=now()+interval '10 minutes',ultimo_error=NULL,intentado_at=now() WHERE id=l.id;
  RETURN to_jsonb(l) || jsonb_build_object('archivos',(SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('refs',
    (SELECT jsonb_agg(to_jsonb(r)) FROM public.evidencia_lote_refs r WHERE r.archivo_id=a.id)) ORDER BY a.id)
    FROM public.evidencia_archivos a WHERE a.lote_id=l.id));
END $$;

CREATE FUNCTION public.evidencia_verificar(p_lote uuid,p_lease uuid,p_ruta text,p_sha text,p_bytes bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.evidencia_lotes SET estado='verificado',zip_ruta=p_ruta,zip_sha256=p_sha,zip_bytes=p_bytes,
    verificado_at=now(),vence_at=now()+interval '24 hours'
    WHERE id=p_lote AND lease=p_lease AND lease_hasta>now() AND estado='preparando'
      AND p_ruta=p_lote::text||'/'||p_lease::text||'.zip' AND p_sha ~ '^[0-9a-f]{64}$' AND p_bytes>0;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOTE_NO_RECLAMADO'; END IF;
END $$;

CREATE FUNCTION public.evidencia_preparar_borrado(p_archivo bigint,p_lease uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.evidencia_archivos; l public.evidencia_lotes;
BEGIN
  SELECT * INTO a FROM public.evidencia_archivos WHERE id=p_archivo FOR UPDATE;
  SELECT * INTO l FROM public.evidencia_lotes WHERE id=a.lote_id FOR UPDATE;
  IF l.lease IS DISTINCT FROM p_lease OR l.lease_hasta<=now() OR l.estado<>'verificado'
    OR l.vence_at<=now()+interval '10 minutes' THEN RAISE EXCEPTION 'LOTE_NO_VERIFICADO'; END IF;
  IF a.estado NOT IN ('reservado','borrando') THEN RETURN a.estado; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('evidencia:'||a.ruta,0));
  IF a.estado='borrando' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidencias' AND o.name=a.ruta) THEN
    RETURN 'borrando'; -- reconciliar una respuesta perdida, sin otro DELETE
  END IF;
  IF public.evidencia_otra_tabla_usa(a.ruta) OR EXISTS (SELECT 1 FROM public.evidencia_referencias r WHERE r.ruta=a.ruta AND NOT EXISTS (
    SELECT 1 FROM public.evidencia_lote_refs x WHERE x.archivo_id=a.id AND x.tabla=r.tabla AND x.registro_id=r.registro_id AND x.campo=r.campo)) THEN
    RETURN 'compartido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidencias' AND o.name=a.ruta
    AND o.id=a.objeto_id AND o.version IS NOT DISTINCT FROM a.objeto_version) THEN
    RAISE EXCEPTION 'ORIGINAL_CAMBIO';
  END IF;
  UPDATE public.evidencia_archivos SET estado='borrando' WHERE id=a.id;
  RETURN 'borrando';
END $$;

-- Defensa conservadora para referencias históricas fuera de los dos modelos
-- actuales. Sólo lectura; no modifica tablas ajenas ni exporta sus datos.
CREATE FUNCTION public.evidencia_otra_tabla_usa(p_ruta text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t record; v_usa boolean;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND c.relname NOT IN ('pedidos','paradas','evidencia_lotes','evidencia_archivos','evidencia_lote_refs') LOOP
    EXECUTE format($query$ SELECT EXISTS(SELECT 1 FROM public.%I fila
      CROSS JOIN LATERAL jsonb_path_query(to_jsonb(fila),'$.** ? (@.type() == "string")') valor
      WHERE public.evidencia_ruta(valor #>> '{}')=$1) $query$,t.relname) INTO v_usa USING p_ruta;
    IF v_usa THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;

CREATE FUNCTION public.evidencia_confirmar_borrado(p_archivo bigint,p_lease uuid,p_compartido boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.evidencia_archivos; l public.evidencia_lotes; r record;
BEGIN
  SELECT * INTO a FROM public.evidencia_archivos WHERE id=p_archivo FOR UPDATE;
  SELECT * INTO l FROM public.evidencia_lotes WHERE id=a.lote_id FOR UPDATE;
  IF l.lease IS DISTINCT FROM p_lease OR l.lease_hasta<=now() OR l.estado<>'verificado' THEN RAISE EXCEPTION 'LOTE_NO_RECLAMADO'; END IF;
  IF a.estado IN ('eliminado','compartido') THEN RETURN; END IF;
  IF NOT p_compartido AND (a.estado<>'borrando' OR EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidencias' AND o.name=a.ruta)) THEN
    RAISE EXCEPTION 'ORIGINAL_AUN_EXISTE';
  END IF;
  IF p_compartido AND public.evidencia_preparar_borrado(p_archivo,p_lease)<>'compartido' THEN RAISE EXCEPTION 'NO_COMPARTIDO'; END IF;
  UPDATE public.evidencia_archivos SET estado=CASE WHEN p_compartido THEN 'compartido' ELSE 'eliminado' END WHERE id=a.id;
  FOR r IN SELECT * FROM public.evidencia_lote_refs WHERE archivo_id=a.id LOOP
    EXECUTE format('UPDATE public.%I SET %I=NULL,evidencias_retiradas_at=now() WHERE id=$1 AND %I=$2',r.tabla,r.campo,r.campo)
      USING r.registro_id,r.valor;
  END LOOP;
END $$;

CREATE FUNCTION public.evidencia_liberar(p_lote uuid,p_lease uuid,p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.evidencia_lotes l SET lease=NULL,lease_hasta=NULL,ultimo_error=left(p_error,100),
    estado=CASE WHEN l.estado='verificado' AND NOT EXISTS(SELECT 1 FROM public.evidencia_archivos a
      WHERE a.lote_id=l.id AND a.estado IN ('reservado','borrando')) THEN 'listo' ELSE l.estado END
    WHERE l.id=p_lote AND l.lease=p_lease;
END $$;

CREATE FUNCTION public.evidencia_expirar(p_lote uuid, p_confirmar boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.evidencia_lotes; a record; r record;
BEGIN
  SELECT * INTO l FROM public.evidencia_lotes WHERE id=p_lote FOR UPDATE;
  IF NOT FOUND OR l.lease_hasta>now()
    OR COALESCE(l.vence_at,l.creado_at+interval '24 hours')>now() THEN RETURN false; END IF;
  IF NOT p_confirmar THEN
    UPDATE public.evidencia_lotes SET estado='expirando',intentado_at=now() WHERE id=l.id; RETURN true;
  END IF;
  IF l.estado<>'expirando' OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='evidencias-zips' AND name LIKE l.id::text||'/%') THEN RETURN false; END IF;
  -- Reconciliar respuestas perdidas sin borrar ningún original adicional.
  FOR a IN SELECT * FROM public.evidencia_archivos WHERE lote_id=l.id AND estado='borrando' FOR UPDATE LOOP
    IF EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidencias' AND o.name=a.ruta) THEN
      UPDATE public.evidencia_archivos SET estado='conservado' WHERE id=a.id;
    ELSE
      UPDATE public.evidencia_archivos SET estado='eliminado' WHERE id=a.id;
      FOR r IN SELECT * FROM public.evidencia_lote_refs WHERE archivo_id=a.id LOOP
        EXECUTE format('UPDATE public.%I SET %I=NULL,evidencias_retiradas_at=now() WHERE id=$1 AND %I=$2',r.tabla,r.campo,r.campo)
          USING r.registro_id,r.valor;
      END LOOP;
    END IF;
  END LOOP;
  UPDATE public.evidencia_archivos a SET estado='conservado' WHERE lote_id=l.id AND estado='reservado';
  UPDATE public.evidencia_lotes SET estado='expirado',lease=NULL,lease_hasta=NULL WHERE id=l.id;
  RETURN true;
END $$;

CREATE FUNCTION public.evidencia_trabajos() RETURNS SETOF public.evidencia_lotes
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT l.* FROM public.evidencia_lotes l WHERE (lease_hasta IS NULL OR lease_hasta<=now())
    AND ((estado<>'expirado' AND (estado IN ('preparando','verificado','expirando') OR vence_at<=now()))
      OR (estado='expirado' AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='evidencias-zips' AND o.name LIKE l.id::text||'/%')))
    ORDER BY COALESCE(intentado_at,creado_at) LIMIT 100;
$$;

-- Bucket privado y políticas restrictivas: una política permisiva preexistente
-- no debe abrir evidencias de entrega ni ZIPs a otro cliente/tenant.
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('evidencias-zips','evidencias-zips',false,110000000)
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit;
UPDATE storage.buckets SET public=false WHERE id='evidencias';

CREATE FUNCTION public.evidencia_puede_leer(p_ruta text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.pedidos p WHERE 'GK-'||p.id=split_part(p_ruta,'/',1) AND (
    (p.user_id=auth.uid()::text AND public.evidencia_es_cliente(auth.uid()::text,p.tenant_id))
    OR EXISTS(SELECT 1 FROM public.usuario_tenant_roles r WHERE r.user_id=auth.uid()::text AND r.tenant_id=p.tenant_id AND r.rol='admin')
    OR EXISTS(SELECT 1 FROM public.repartidores r WHERE r.id=p.repartidor_id AND r.user_id=auth.uid() AND r.tenant_id=p.tenant_id)));
$$;
CREATE FUNCTION public.evidencia_puede_escribir(p_ruta text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('evidencia:'||p_ruta,0));
  RETURN NOT EXISTS(SELECT 1 FROM public.evidencia_archivos a WHERE a.ruta=p_ruta AND a.estado IN ('reservado','borrando','eliminado'))
    AND EXISTS(SELECT 1 FROM public.pedidos p JOIN public.repartidores r ON r.id=p.repartidor_id
      WHERE 'GK-'||p.id=split_part(p_ruta,'/',1) AND r.user_id=auth.uid() AND r.tenant_id=p.tenant_id);
END $$;
CREATE POLICY evidencia_zip_cerrado ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING(bucket_id<>'evidencias-zips') WITH CHECK(bucket_id<>'evidencias-zips');
CREATE POLICY evidencia_entrega_lectura_limite ON storage.objects AS RESTRICTIVE FOR SELECT TO anon,authenticated
  USING(bucket_id<>'evidencias' OR name !~ '^GK-[0-9]+/(foto\.jpg|firma\.png|parada-[0-9]+\.jpg|firma-parada-[0-9]+\.png)$' OR public.evidencia_puede_leer(name));
CREATE POLICY evidencia_entrega_lectura ON storage.objects FOR SELECT TO authenticated
  USING(bucket_id='evidencias' AND public.evidencia_puede_leer(name));
CREATE POLICY evidencia_entrega_insert_limite ON storage.objects AS RESTRICTIVE FOR INSERT TO anon,authenticated
  WITH CHECK(bucket_id<>'evidencias' OR name !~ '^GK-[0-9]+/(foto\.jpg|firma\.png|parada-[0-9]+\.jpg|firma-parada-[0-9]+\.png)$' OR public.evidencia_puede_escribir(name));
CREATE POLICY evidencia_entrega_update_limite ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon,authenticated
  USING(bucket_id<>'evidencias' OR name !~ '^GK-[0-9]+/(foto\.jpg|firma\.png|parada-[0-9]+\.jpg|firma-parada-[0-9]+\.png)$' OR public.evidencia_puede_escribir(name))
  WITH CHECK(bucket_id<>'evidencias' OR name !~ '^GK-[0-9]+/(foto\.jpg|firma\.png|parada-[0-9]+\.jpg|firma-parada-[0-9]+\.png)$' OR public.evidencia_puede_escribir(name));
CREATE POLICY evidencia_entrega_delete_limite ON storage.objects AS RESTRICTIVE FOR DELETE TO anon,authenticated
  USING(bucket_id<>'evidencias' OR name !~ '^GK-[0-9]+/(foto\.jpg|firma\.png|parada-[0-9]+\.jpg|firma-parada-[0-9]+\.png)$');

-- Sólo el backend puede iniciar y avanzar estados. El resumen es de sólo lectura.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT oid::regprocedure firma FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'evidencia\_%' ESCAPE '\' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.firma);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.evidencia_resumen(bigint),
  public.evidencia_puede_leer(text),public.evidencia_puede_escribir(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.evidencia_puede_leer(text),public.evidencia_puede_escribir(text) TO anon;
COMMIT;
