select 'auth' as tabla, count(*) from auth.users where email = 'b21-atomic@example.test'
union all
select 'perfil', count(*) from public.usuarios where email = 'b21-atomic@example.test'
union all
select 'membresia', count(*) from public.usuario_tenant_roles utr join public.usuarios u on u.user_id = utr.user_id where u.email = 'b21-atomic@example.test';

drop trigger b21_forzar_fallo_membresia on public.usuario_tenant_roles;
drop function public.b21_forzar_fallo_membresia();

do $block$
begin
  begin
    insert into auth.users (
      id, aud, role, phone, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
      '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
      '+15550000001', '{}'::jsonb, '{}'::jsonb, now(), now()
    );
  exception when others then
    raise notice 'telefono: %', sqlerrm;
  end;
end;
$block$;

select count(*) as auth_phone
from auth.users
where id = '22222222-2222-4222-8222-222222222222';
