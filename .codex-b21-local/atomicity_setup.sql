delete from public.usuario_tenant_roles
where user_id in (select user_id from public.usuarios where email = 'b21-atomic@example.test');
delete from public.usuarios where email = 'b21-atomic@example.test';
delete from auth.users where email = 'b21-atomic@example.test';

create or replace function public.b21_forzar_fallo_membresia()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'B21_FALLO_FORZADO_MEMBRESIA';
end;
$function$;

create trigger b21_forzar_fallo_membresia
before insert on public.usuario_tenant_roles
for each row execute function public.b21_forzar_fallo_membresia();
