create table if not exists direcciones_guardadas (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tipo        text not null check (tipo in ('origen','destino')),
  alias       text not null,
  nombre      text not null,
  telefono    text not null,
  email       text,
  calle       text not null,
  numero      text,
  colonia     text not null,
  ciudad      text not null,
  estado      text not null,
  cp          text not null,
  referencia  text,
  created_at  timestamptz not null default now()
);

alter table direcciones_guardadas enable row level security;

drop policy if exists "usuarios_ven_sus_direcciones" on direcciones_guardadas;
create policy "usuarios_ven_sus_direcciones" on direcciones_guardadas
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "usuarios_crean_direcciones" on direcciones_guardadas;
create policy "usuarios_crean_direcciones" on direcciones_guardadas
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "usuarios_borran_direcciones" on direcciones_guardadas;
create policy "usuarios_borran_direcciones" on direcciones_guardadas
  for delete to authenticated using (auth.uid() = user_id);
