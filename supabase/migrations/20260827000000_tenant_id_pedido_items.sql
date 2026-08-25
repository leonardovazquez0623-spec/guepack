alter table public.pedido_items
  add column if not exists tenant_id bigint references public.tenants(id);

create index if not exists pedido_items_tenant_id_idx
  on public.pedido_items (tenant_id);

-- Por si ya hay renglones sueltos de intentos previos, para no dejarlos huérfanos
update public.pedido_items pi
set tenant_id = p.tenant_id
from public.pedidos p
where pi.pedido_id = p.id
  and pi.tenant_id is null;

drop policy if exists "select pedido_items propio" on public.pedido_items;
create policy "select pedido_items propio" on public.pedido_items
  for select
  to public
  using (
    (pedido_id in (select id from public.pedidos where user_id = auth.uid()::text))
    or (is_admin() and tenant_id = mi_tenant_id())
  );

drop policy if exists "insert pedido_items autenticado" on public.pedido_items;
create policy "insert pedido_items autenticado" on public.pedido_items
  for insert
  to authenticated
  with check (
    pedido_id in (select id from public.pedidos where user_id = auth.uid()::text)
  );
