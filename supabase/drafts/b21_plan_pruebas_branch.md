# B2.1 — Plan de pruebas en Supabase Branch

Este documento no crea ni modifica branches. Describe el gate previo a cualquier
despliegue de producción.

## 1. Preparar un entorno aislado

1. Crear una Git branch y una Supabase Preview Branch asociada.
2. Copiar `b21_cerrar_fuga_handle_new_user.sql` a una migración timestamped
   **solo dentro de esa Git branch**.
3. Esperar a que Database, Auth y API de la branch estén saludables.
4. Confirmar el project ref, URL y publishable key propios de la branch.
5. No copiar datos personales de producción. Sembrar únicamente:
   - tenants de prueba activos con dominio controlado;
   - una empresa afiliada activa con código de prueba;
   - cualquier catálogo mínimo requerido por las políticas actuales.

Las branches no contienen datos de producción y tienen credenciales y Auth
independientes. El seed debe ser explícito.

## 2. Conectar la Preview web a la branch correcta

El frontend actual es estático y tiene la URL/clave de producción hardcodeadas.
La integración Vercel/Supabase no basta mientras esos archivos no consuman
variables de entorno.

Para la prueba, crear un commit **solo de prueba y no mergeable** que reemplace
URL y publishable key por los de la branch en:

- `config.js` (cliente usado por login/auth.js);
- `tenant-config.js`;
- `redirect.html`;
- `splash.html`.

Verificar en Network que `/auth/v1`, `/rest/v1` y `/rpc/` apuntan al project ref
de la branch. Si aparece el ref de producción, detener la prueba.

Configurar en Auth de la branch:

- confirmación de correo activa;
- URL de la Preview en Site URL y Redirect URLs;
- Google con credenciales de prueba o secretos propios de la branch;
- un dominio/alias de Preview cuyo host coincida con el `dominio` del tenant de
  prueba.

## 3. Verificaciones de migración

Después de que la branch aplique la migración:

1. `usuarios.tenant_id` debe seguir nullable y tener default NULL.
2. `usuarios.email` debe seguir NOT NULL.
3. Deben existir `usuarios_user_id_uniq` y
   `tenants_dominio_lower_uniq`.
4. Debe seguir existiendo el único `(user_id, tenant_id)` de
   `usuario_tenant_roles`; no debe existir un índice triple con `rol`.
5. `pg_get_functiondef()` debe coincidir con el borrador aprobado.
6. `handle_new_user()` debe conservar su ACL anterior.
7. `auto_asignar_rol_cliente(bigint)` solo debe tener EXECUTE efectivo para
   `authenticated`, `service_role` y el owner.

## 4. Matriz de altas reales sobre `auth.users`

Todas las pruebas usan Supabase Auth real de la branch; no usan una tabla
temporal compatible.

| Caso | Acción | Resultado esperado |
|---|---|---|
| Correo + tenant válido | Signup con metadata `tenant_id` válida | Una fila en `auth.users`, perfil y membresía cliente con el mismo tenant |
| Correo + tenant inválido | Signup con ID inexistente/inactivo | Auth devuelve fallo genérico; cero filas parciales en las tres tablas |
| Correo sin tenant | Signup sin tenant ni empresa | Perfil con tenant NULL, sin membresía y sin acceso RLS |
| Empresa válida | Signup con `empresa_codigo` de prueba | Tenant resuelto y membresía atómica |
| Empresa incompatible | Tenant A + empresa de tenant B | Alta rechazada y cero filas parciales |
| Email ya ligado | Precrear perfil ligado a otro UUID y registrar ese email | `EMAIL_YA_ASOCIADO_A_OTRO_PERFIL`; perfil intacto |
| Google nuevo | Alta OAuth real sin metadata tenant | Primero perfil NULL/sin membresía; callback resuelve perfil y membresía |
| Phone | Habilitar Phone/test OTP solo en la branch e intentar alta | `ALTA_TELEFONO_NO_SOPORTADA`; cero perfil/membresía |

En los fallos de trigger, comprobar el mensaje amigable de `auth.js`; el usuario
no debe ver el error 500 crudo.

## 5. RPC, Origin e idempotencia

Con un usuario autenticado de prueba:

1. Origin correspondiente al tenant + `p_tenant_id` coincidente: actualiza un
   perfil NULL y crea una membresía.
2. Ejecutar el RPC dos veces: una sola membresía y mismo tenant.
3. Perfil ya resuelto al mismo tenant: éxito sin cambios de rol.
4. Perfil resuelto a otro tenant: rechazo sin cambios.
5. Origin correcto + `p_tenant_id` distinto: rechazo.
6. Origin desconocido o ausente: rechazo.
7. `www.` debe normalizarse antes de comparar.
8. `localhost` contra la branch remota: rechazo.
9. La excepción localhost permitida se prueba aparte con `supabase start`,
   donde frontend y API son locales.

## 6. Frontend y PWA

En la misma Preview web deben estar los cuatro diffs y `guepack-v13`:

1. Correo existente con membresía: redirección por rol sin llamar el RPC.
2. Usuario sin membresía: RPC, relectura del rol y redirección solo después del
   éxito.
3. Error del RPC: mensaje visible; no entrar en `app.html`.
4. Google nuevo: `redirect.html` completa tenant + membresía antes de continuar.
5. `splash.html`: cero INSERT directo en `usuario_tenant_roles`.
6. Tenant no resuelto: ninguna ruta usa fallback a 1.
7. Instalar la PWA de Preview con la versión anterior, desplegar v13, cerrarla y
   abrirla de nuevo. Confirmar worker v13 activo y cachés anteriores eliminadas.

## 7. Atomicidad forzada

En la branch, instalar temporalmente un trigger de prueba que lance excepción
antes de insertar una membresía para un email/UUID de prueba. Ejecutar un signup
real y comprobar que la transacción tampoco deja `auth.users` ni `usuarios`.
Retirar inmediatamente ese trigger auxiliar y repetir un signup exitoso.

## 8. Rollback en la branch

1. Ejecutar `b21_rollback_cerrar_fuga_handle_new_user.sql` únicamente en la
   branch.
2. Confirmar default 1, índices eliminados, definiciones anteriores y ACL.
3. Confirmar explícitamente que el rollback no borra datos creados durante las
   pruebas.
4. Eliminar/recrear la Preview Branch antes de una segunda corrida para evitar
   historial o datos residuales.

## Gate de salida

No promover ni copiar el SQL a `supabase/migrations` de la rama de producción
hasta que todos los casos anteriores pasen y se revisen los cuatro diffs, el SQL
y el rollback. El merge y el despliegue requieren una autorización posterior.
