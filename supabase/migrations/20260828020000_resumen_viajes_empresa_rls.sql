-- Resumen de viajes por empresa corporativa (admin.html + app.html):
-- un cliente corporativo debe poder leer TODOS los pedidos de SU empresa,
-- no solo los que él mismo creó. La policy existente "select pedidos
-- propios o admin" solo cubre auth.uid() = user_id, así que un empleado
-- de una empresa afiliada no vería los pedidos creados por otro empleado
-- de la misma empresa_codigo.
--
-- Se agrega una policy NUEVA y SEPARADA (no se toca ni se reemplaza la
-- existente) para que este cambio se pueda revertir de forma aislada con
-- un solo DROP POLICY si algo sale mal.
--
-- Vínculo usuario→empresa: usuarios.empresa_codigo (mismo campo que ya
-- usa _cargarEmpresaUsuario() en app.html — primero user_metadata,
-- fallback a esta columna — y el filtro por empresa en admin.html).
--
-- mi_empresa_codigo() sigue el mismo patrón SECURITY DEFINER que
-- mi_tenant_id()/mi_nombre()/es_admin_de() (20260820010000): necesario
-- porque un EXISTS/subquery inline sobre usuarios dentro de una policy de
-- pedidos quedaría sujeto a las policies RLS de usuarios para el rol
-- authenticated, en vez de resolverse una sola vez con privilegios del
-- dueño de la función.
--
-- tenant_id se exige también en el USING: empresa_codigo no es único
-- entre tenants (dos tenants distintos podrían reusar el mismo código de
-- empresa), así que sin este filtro un cliente corporativo podría leer
-- pedidos de una empresa homónima en otro tenant.

begin;

create or replace function public.mi_empresa_codigo()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select u.empresa_codigo
  from public.usuarios u
  where u.user_id = auth.uid()::text;
$function$;

revoke execute on function public.mi_empresa_codigo() from public, anon;
grant execute on function public.mi_empresa_codigo() to authenticated;

drop policy if exists "empresa ve pedidos de su empresa" on public.pedidos;

create policy "empresa ve pedidos de su empresa"
  on public.pedidos for select to authenticated
  using (
    empresa_codigo is not null
    and empresa_codigo = public.mi_empresa_codigo()
    and tenant_id = public.mi_tenant_id()
  );

commit;
