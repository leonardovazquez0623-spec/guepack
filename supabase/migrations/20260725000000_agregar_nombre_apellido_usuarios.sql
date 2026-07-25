ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS nombre TEXT,
  ADD COLUMN IF NOT EXISTS apellido TEXT;

ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_nombre_longitud_valida;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_nombre_longitud_valida
  CHECK (
    nombre IS NULL
    OR char_length(btrim(nombre)) BETWEEN 1 AND 100
  );

ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_apellido_longitud_valida;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_apellido_longitud_valida
  CHECK (
    apellido IS NULL
    OR char_length(btrim(apellido)) BETWEEN 1 AND 100
  );

COMMENT ON COLUMN public.usuarios.nombre IS
  'Nombre del usuario mostrado en el saludo y perfil.';

COMMENT ON COLUMN public.usuarios.apellido IS
  'Apellido del usuario mostrado en el perfil.';
