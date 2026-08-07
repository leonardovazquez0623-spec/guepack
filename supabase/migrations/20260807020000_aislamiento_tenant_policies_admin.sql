-- ════════════════════════════════════════════════════════════════
-- GUEPACK · Corrección de aislamiento multi-tenant en políticas RLS
--
-- APLICADA EN PRODUCCIÓN el 2026-08-07 vía SQL Editor; este archivo
-- formaliza el cambio en el historial de migraciones. Es idempotente
-- (DROP POLICY IF EXISTS antes de cada CREATE, CREATE OR REPLACE en
-- la función) para que un `db push` posterior no falle al reejecutar.
--
-- Contexto: en Postgres las políticas RLS permisivas de una misma
-- operación se combinan con OR — bastaba UNA política con is_admin()
-- sin comparación de tenant para que cualquier admin de cualquier
-- tenant leyera/modificara datos ajenos, aunque existiera otra
-- política correcta en la misma tabla.
--
-- Cierra:
--   · 10 políticas admin sin filtro de tenant (tenants, usuarios,
--     pedidos, cupones, usuario_tenant_roles, admin_log,
--     eventos_trafico, rondas_pendientes, menu_categorias,
--     menu_productos, sucursales, clientes_widget, config_app,
--     anuncios)
--   · pedidos: término "repartidor IS NULL AND estado='Pendiente'"
--     visible globalmente → acotado al tenant
--   · config_app: SELECT abierta a todo authenticated que exponía
--     tokens cacheados de Skydropx → whitelist de llaves operativas
--     (tras aplicar se rotaron/deben rotarse los tokens expuestos)
--   · anuncios: INSERT con WITH CHECK (true) sin flujo legítimo
--   · rondas_pendientes: INSERT/UPDATE abiertos que solo usaba
--     procesar-asignacion con service_role (bypasea RLS; no las
--     necesita)
--   · admin_log: 4 políticas duplicadas → 2 limpias
--
-- Esquemas confirmados contra producción (preflight 2026-08-07):
--   · rondas_pendientes NO tiene tenant_id (solo pedido_id integer)
--     → filtro vía JOIN a pedidos
--   · clientes_widget NO tiene concepto de tenant (registro global
--     de embeds del widget de plataforma) → superadmin-only
--   · anuncios, cupones, eventos_trafico, menu_categorias,
--     menu_productos, sucursales SÍ tienen tenant_id
--
-- Quals de pedidos y usuario_tenant_roles: reconstruidos a partir
-- del texto EXACTO de pg_policies de producción, conservando los
-- términos de dueño/repartidor y acotando solo los términos admin.
--
-- Pendiente (fases aparte, NO cubierto aquí):
--   · cotizaciones_log: SELECT global para cualquier admin
--   · is_admin()/mi_tenant_id() siguen leyendo la tabla legada
--     usuarios (rol/tenant_id); la migración de fuente a
--     usuario_tenant_roles es un cambio separado
-- ════════════════════════════════════════════════════════════════

-- ── Helper ──
-- Necesario porque: (a) al acotar por tenant, el superadmin (cuyo
-- mi_tenant_id() puede ser NULL) perdería acceso sin una rama propia;
-- (b) en usuarios/usuario_tenant_roles un EXISTS inline sobre
-- usuarios provocaría recursión infinita de RLS — debe ser
-- SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.es_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.user_id::text = auth.uid()::text
      AND u.es_superadmin IS TRUE
  );
$$;
REVOKE ALL ON FUNCTION public.es_superadmin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_superadmin() TO authenticated;

BEGIN;

-- ════════════════════════════════════════════════════════════════
-- 1. tenants — gestión solo superadmin; admin conserva SELECT de su
--    propio tenant (admin.html lee zona_horaria/branding)
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "super admin gestiona tenants" ON public.tenants;
DROP POLICY IF EXISTS "admin lee su propio tenant"   ON public.tenants;

CREATE POLICY "super admin gestiona tenants"
  ON public.tenants FOR ALL TO authenticated
  USING (public.es_superadmin())
  WITH CHECK (public.es_superadmin());

CREATE POLICY "admin lee su propio tenant"
  ON public.tenants FOR SELECT TO authenticated
  USING (public.is_admin() AND id = public.mi_tenant_id());

-- ════════════════════════════════════════════════════════════════
-- 2. usuarios — admin solo ve usuarios de su tenant
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin puede ver todos los usuarios"     ON public.usuarios;
DROP POLICY IF EXISTS "admin puede ver usuarios de su tenant"  ON public.usuarios;

CREATE POLICY "admin puede ver usuarios de su tenant"
  ON public.usuarios FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND tenant_id = public.mi_tenant_id())
    OR public.es_superadmin()
  );

-- ════════════════════════════════════════════════════════════════
-- 3. pedidos — qual exacto de producción con dos términos acotados:
--    is_admin() → + tenant; Pendiente sin repartidor → + tenant
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "select pedidos propios o admin" ON public.pedidos;

CREATE POLICY "select pedidos propios o admin"
  ON public.pedidos FOR SELECT TO authenticated
  USING (
    ((auth.uid())::text = user_id)
    OR (public.is_admin() AND tenant_id = public.mi_tenant_id())
    OR public.es_superadmin()
    OR (repartidor = public.mi_nombre())
    OR (
      (repartidor IS NULL)
      AND (estado = 'Pendiente'::text)
      AND (tenant_id = public.mi_tenant_id())
    )
  );

-- ════════════════════════════════════════════════════════════════
-- 4. cupones — ALL alineada con la SELECT por tenant ya correcta
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin gestiona cupones" ON public.cupones;

CREATE POLICY "admin gestiona cupones"
  ON public.cupones FOR ALL TO authenticated
  USING (
    (public.is_admin() AND tenant_id = public.mi_tenant_id())
    OR public.es_superadmin()
  )
  WITH CHECK (
    (public.is_admin() AND tenant_id = public.mi_tenant_id())
    OR public.es_superadmin()
  );

-- ════════════════════════════════════════════════════════════════
-- 5. usuario_tenant_roles — qual exacto; término admin acotado
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "usuario ve sus propios roles" ON public.usuario_tenant_roles;

CREATE POLICY "usuario ve sus propios roles"
  ON public.usuario_tenant_roles FOR SELECT TO authenticated
  USING (
    ((auth.uid())::text = user_id)
    OR (public.is_admin() AND tenant_id = public.mi_tenant_id())
    OR public.es_superadmin()
  );

-- ════════════════════════════════════════════════════════════════
-- 6. admin_log — log GLOBAL sin tenant_id: 4 políticas duplicadas
--    (dos pares SELECT/INSERT) → 2 limpias. Lectura superadmin,
--    escritura cualquier admin (registra sus propias acciones).
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin ve logs"          ON public.admin_log;
DROP POLICY IF EXISTS "admin_log_select"       ON public.admin_log;
DROP POLICY IF EXISTS "admin_log_insert"       ON public.admin_log;
DROP POLICY IF EXISTS "insert log autenticado" ON public.admin_log;
DROP POLICY IF EXISTS "superadmin ve logs"     ON public.admin_log;
DROP POLICY IF EXISTS "admin inserta su log"   ON public.admin_log;

CREATE POLICY "superadmin ve logs"
  ON public.admin_log FOR SELECT TO authenticated
  USING (public.es_superadmin());

CREATE POLICY "admin inserta su log"
  ON public.admin_log FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ════════════════════════════════════════════════════════════════
-- 7. eventos_trafico — filtro por tenant (filas históricas con
--    tenant_id NULL quedan visibles solo para superadmin)
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin ve trafico"               ON public.eventos_trafico;
DROP POLICY IF EXISTS "admin ve trafico de su tenant"  ON public.eventos_trafico;

CREATE POLICY "admin ve trafico de su tenant"
  ON public.eventos_trafico FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND tenant_id = public.mi_tenant_id())
    OR public.es_superadmin()
  );

-- ════════════════════════════════════════════════════════════════
-- 8. rondas_pendientes — sin tenant_id: SELECT acotado vía JOIN a
--    pedidos. DROP de INSERT/UPDATE abiertos: solo escribe
--    procesar-asignacion con service_role (bypasea RLS, no las
--    necesita); ningún flujo de navegador escribe esta tabla.
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "insert rondas sistema"          ON public.rondas_pendientes;
DROP POLICY IF EXISTS "update rondas sistema"          ON public.rondas_pendientes;
DROP POLICY IF EXISTS "admin ve rondas"                ON public.rondas_pendientes;
DROP POLICY IF EXISTS "admin ve rondas de su tenant"   ON public.rondas_pendientes;

CREATE POLICY "admin ve rondas de su tenant"
  ON public.rondas_pendientes FOR SELECT TO authenticated
  USING (
    (public.is_admin() AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = rondas_pendientes.pedido_id
        AND p.tenant_id = public.mi_tenant_id()
    ))
    OR public.es_superadmin()
  );

-- ════════════════════════════════════════════════════════════════
-- 9a. menu_categorias / menu_productos / sucursales — tienen
--     tenant_id (confirmado): ALL acotada por tenant
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin gestiona menu_categorias" ON public.menu_categorias;
CREATE POLICY "admin gestiona menu_categorias"
  ON public.menu_categorias FOR ALL TO authenticated
  USING ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin())
  WITH CHECK ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin());

DROP POLICY IF EXISTS "admin gestiona menu_productos" ON public.menu_productos;
CREATE POLICY "admin gestiona menu_productos"
  ON public.menu_productos FOR ALL TO authenticated
  USING ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin())
  WITH CHECK ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin());

DROP POLICY IF EXISTS "admin gestiona sucursales" ON public.sucursales;
CREATE POLICY "admin gestiona sucursales"
  ON public.sucursales FOR ALL TO authenticated
  USING ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin())
  WITH CHECK ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin());

-- ════════════════════════════════════════════════════════════════
-- 9b. config_app — tabla GLOBAL key/value que cachea tokens de APIs
--     externas. La SELECT abierta a authenticated exponía esos
--     tokens (rotados tras el incidente). Escritura superadmin;
--     lectura por whitelist verificada contra todo el frontend:
--       repartidor.html → mapbox_token
--       admin.html      → asignacion_activa, tiempo_aceptar,
--                         pausa_rondas, max_rondas,
--                         envios_gratis_por_referido
--     (skydropx-auth y procesar-asignacion usan service_role)
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin gestiona config_app"        ON public.config_app;
DROP POLICY IF EXISTS "select config_app autenticado"    ON public.config_app;
DROP POLICY IF EXISTS "superadmin gestiona config_app"   ON public.config_app;
DROP POLICY IF EXISTS "authenticated lee llaves operativas" ON public.config_app;

CREATE POLICY "superadmin gestiona config_app"
  ON public.config_app FOR ALL TO authenticated
  USING (public.es_superadmin())
  WITH CHECK (public.es_superadmin());

CREATE POLICY "authenticated lee llaves operativas"
  ON public.config_app FOR SELECT TO authenticated
  USING (key IN (
    'mapbox_token',
    'asignacion_activa',
    'tiempo_aceptar',
    'pausa_rondas',
    'max_rondas',
    'envios_gratis_por_referido'
  ));

-- ════════════════════════════════════════════════════════════════
-- 9c. clientes_widget — SIN concepto de tenant (id, nombre, codigo,
--     activo, created_at): registro global de embeds del widget de
--     plataforma → superadmin-only, como config_app/admin_log
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "admin gestiona clientes_widget"      ON public.clientes_widget;
DROP POLICY IF EXISTS "superadmin gestiona clientes_widget" ON public.clientes_widget;

CREATE POLICY "superadmin gestiona clientes_widget"
  ON public.clientes_widget FOR ALL TO authenticated
  USING (public.es_superadmin())
  WITH CHECK (public.es_superadmin());

-- ════════════════════════════════════════════════════════════════
-- 10. anuncios — ALL acotada por tenant + DROP del INSERT abierto
--     (WITH CHECK true sin ningún flujo legítimo: el único INSERT
--     es el flujo admin de admin.html, cubierto por la ALL)
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "allow insert anuncios"   ON public.anuncios;
DROP POLICY IF EXISTS "admin gestiona anuncios" ON public.anuncios;

CREATE POLICY "admin gestiona anuncios"
  ON public.anuncios FOR ALL TO authenticated
  USING ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin())
  WITH CHECK ((public.is_admin() AND tenant_id = public.mi_tenant_id()) OR public.es_superadmin());

COMMIT;
