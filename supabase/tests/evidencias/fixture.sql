-- Esquema mínimo de prueba. No se ejecuta contra ningún proyecto Supabase.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth,storage,public TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
CREATE TABLE public.tenants(id bigint PRIMARY KEY,activo boolean NOT NULL DEFAULT true);
CREATE TABLE public.usuario_tenant_roles(user_id text,tenant_id bigint,rol text,PRIMARY KEY(user_id,tenant_id));
CREATE TABLE public.repartidores(id bigint PRIMARY KEY,user_id uuid,tenant_id bigint);
CREATE TABLE public.pedidos(id bigint PRIMARY KEY,user_id text,tenant_id bigint,repartidor_id bigint,estado text,
  entregado_at timestamptz,created_at timestamptz DEFAULT now(),foto_evidencia text,firma_evidencia text,
  foto_recoleccion text,firma_recoleccion text,comprobante_pago text,foto_receta_surtido text,firma_receta_surtido text);
CREATE TABLE public.paradas(id bigint PRIMARY KEY,pedido_id bigint REFERENCES public.pedidos(id),orden integer,
  estado text,completada_at timestamptz,foto_url text,firma_url text);
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,
  version text DEFAULT 'v1',metadata jsonb,UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO anon,authenticated,service_role;
CREATE POLICY legacy_abierta ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE,INSERT,DELETE ON public.pedidos,public.paradas TO authenticated;
INSERT INTO storage.buckets VALUES('evidencias','evidencias',true,52428800);
INSERT INTO public.tenants VALUES(1,true),(2,true);
INSERT INTO public.usuario_tenant_roles VALUES
('11111111-1111-4111-8111-111111111111',1,'cliente'),
('22222222-2222-4222-8222-222222222222',2,'cliente'),
('33333333-3333-4333-8333-333333333333',1,'cliente'),
('44444444-4444-4444-8444-444444444444',1,'repartidor');
INSERT INTO public.repartidores VALUES(1,'44444444-4444-4444-8444-444444444444',1);
-- Datos históricos ANTES de aplicar la migración.
INSERT INTO public.pedidos(id,user_id,tenant_id,repartidor_id,estado,entregado_at,foto_evidencia,firma_evidencia,foto_recoleccion,comprobante_pago) VALUES
(101,'11111111-1111-4111-8111-111111111111',1,1,'Entregado',now()-interval '45 days','GK-101/foto.jpg','https://project.supabase.co/storage/v1/object/public/evidencias/GK-101/firma.png','GK-101/recoleccion.jpg','comprobantes/101.jpg'),
(102,'11111111-1111-4111-8111-111111111111',1,1,'Entregado',now()-interval '29 days','GK-102/foto.jpg',NULL,NULL,NULL),
(103,'11111111-1111-4111-8111-111111111111',1,1,'Entregado',NULL,'GK-103/foto.jpg',NULL,NULL,NULL),
(201,'22222222-2222-4222-8222-222222222222',2,NULL,'Entregado',now()-interval '50 days','GK-201/foto.jpg',NULL,NULL,NULL),
(104,'11111111-1111-4111-8111-111111111111',1,1,'Entregado',now()-interval '40 days',NULL,NULL,NULL,NULL);
INSERT INTO public.paradas VALUES(501,104,1,'completada',now()-interval '40 days','GK-104/parada-1.jpg',NULL);
