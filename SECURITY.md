# 🔒 GUEPACK Express — Security Policy

## Estado actual de seguridad · Julio 2026

---

## ✅ Implementado

### Autenticación y Autorización
- Supabase Auth con JWT para todas las sesiones
- Verificación de email obligatoria antes de acceder a la app
- Verificación de rol server-side en admin, repartidor y cliente
- Protección contra cambio de rol propio (política RLS con WITH CHECK)
- Rate limiting en Supabase: 3 sign-ins por 5 minutos
- Retry automático de sesión en repartidor.html (5 intentos × 800ms)

### Row Level Security (RLS)
- RLS activado en **todas** las tablas públicas
- Políticas granulares por rol: cliente / repartidor / admin
- Funciones SECURITY DEFINER: `is_admin()`, `mi_nombre()`
- Acceso anónimo eliminado de tablas sensibles
- Tabla `pedidos` solo accesible por dueño, repartidor asignado o admin
- Tabla `usuarios` solo accesible por el propio usuario o admin

### API y Edge Functions
- CORS restringido a `https://guepack.com` y `https://www.guepack.com`
- Verificación JWT en Edge Functions sensibles (`chat-soporte-ia`, `eliminar-usuario`)
- Verificación de rol admin antes de eliminar cuentas
- Firebase private key movida a secretos de Supabase (no en código)
- Rastreo público via Edge Function dedicada (sin exponer tabla `pedidos`)
- Rate limiting en Supabase Auth

### Protección de Datos
- Sanitización XSS en admin.html con `escaparHTML()`
- Inputs validados: WhatsApp (10 dígitos), nombre (letras), dirección (max 300 chars)
- Tokens FCM nunca expuestos completos en logs
- Contraseñas: mínimo 8 chars, mayúsculas, minúsculas y carácter especial
- WhatsApp único por usuario (anti-fraude en referidos)

### Infraestructura
- HTTPS forzado via Vercel
- Service Worker no cachea tokens ni datos de sesión
- APIs externas (Supabase, Firebase, Google Maps) excluidas del SW cache
- Google Maps API restringida a dominio `guepack.com`
- Firebase Web Key restringida a `guepack.com`

### Auditoría
- Tabla `admin_log` registra todas las acciones críticas del admin
- Log incluye: email del admin, acción, detalle JSON, timestamp

---

## ⚠️ Pendiente / En progreso

### Zero Trust
- [ ] 2FA para cuentas admin
- [ ] IP allowlist para acceso al dashboard de Supabase
- [ ] Notificación automática al crear cuenta nueva
- [ ] Alerta cuando se intenta acceder a admin.html sin permisos

### Código
- [ ] Migrar Google Maps a `loading=async` (warning de rendimiento)
- [ ] Content Security Policy (CSP) headers en Vercel
- [ ] Subresource Integrity (SRI) para scripts externos

### Servidor
- [ ] Logs de acceso a Edge Functions en producción
- [ ] Alertas automáticas por actividad sospechosa (múltiples logins fallidos)
- [ ] Backup automático de base de datos

### Datos
- [ ] Política de retención de datos (LFPDPPP)
- [ ] Proceso formal de eliminación de cuenta (ARCO)
- [ ] Cifrado de campos sensibles (WhatsApp, direcciones)

---

## 🚨 Incidentes registrados

### Julio 2026 — Acceso no autorizado
- **Qué pasó:** Usuario malicioso (`pizduc.98@gmail.com`) encontró políticas RLS permisivas, se registró y escaló privilegios a admin. Creó cupón fraudulento y lo distribuyó.
- **Impacto:** Cupón enviado a clientes, acceso temporal a datos de usuarios.
- **Acciones tomadas:**
  - Usuario eliminado de auth.users y usuarios
  - Políticas RLS de cupones corregidas
  - Políticas `allow insert/update/delete` eliminadas de tablas sensibles
  - Política de cambio de rol propio bloqueada
  - Nueva Supabase publishable key generada
  - Tabla `pedidos` protegida con Edge Function para rastreo público

---

## 📋 Checklist de seguridad mensual

- [ ] Revisar `admin_log` por actividad sospechosa
- [ ] Verificar que no hay tablas con RLS desactivado
- [ ] Rotar API keys si hay sospechas de filtración
- [ ] Revisar usuarios registrados sin verificar email
- [ ] Verificar rate limits de Supabase Auth
- [ ] Revisar logs de Edge Functions

---

## 📞 Reporte de vulnerabilidades

Si encuentras una vulnerabilidad de seguridad en GUEPACK Express, repórtala de forma responsable a:

**Email:** contacto@guepack.com  
**Asunto:** [SECURITY] Descripción breve

No publiques vulnerabilidades públicamente antes de que sean corregidas.

---

*Documento mantenido por Leonardo Vázquez Fajardo · GUEPACK Express*  
*Última actualización: Julio 2026*
