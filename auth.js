let tenantActualLogin = null

function urlDelTenant(ruta) { return new URL(ruta, window.location.origin).href }

function showError(msg) {
  const error = document.getElementById('error-msg')
  error.textContent = msg
  error.style.display = 'block'
  document.getElementById('success-msg').style.display = 'none'
}

function showSuccess(msg) {
  const success = document.getElementById('success-msg')
  success.textContent = msg
  success.style.display = 'block'
  document.getElementById('error-msg').style.display = 'none'
}

function aplicarBrandingLogin(tenant) {
  if (!tenant) return
  tenantActualLogin = tenant
  const nombre = tenant.nombre_app || tenant.nombre || 'GUEPACK Express'
  document.title = `${nombre} – Iniciar Sesión`
  document.getElementById('login-tenant-welcome').textContent = `Bienvenido a ${nombre}`
  if (tenant.logo_url) {
    const logo = document.getElementById('login-tenant-logo')
    logo.src = tenant.logo_url
    logo.alt = nombre
  }
  const mascota = document.getElementById('login-tenant-mascot')
  mascota.style.display = tenant.img_bienvenida ? 'block' : 'none'
  if (tenant.img_bienvenida) mascota.src = tenant.img_bienvenida
}

function showRegister() {
  document.getElementById('login-form').style.display = 'none'
  document.getElementById('register-form').style.display = 'block'
}

function showLogin() {
  document.getElementById('register-form').style.display = 'none'
  document.getElementById('forgot-form').style.display = 'none'
  document.getElementById('login-form').style.display = 'block'
}

function showForgot() {
  document.getElementById('login-form').style.display = 'none'
  document.getElementById('register-form').style.display = 'none'
  document.getElementById('forgot-form').style.display = 'block'
  document.getElementById('error-msg').style.display = 'none'
  document.getElementById('success-msg').style.display = 'none'
}

function _togglePasswordVis() {
  const input = document.getElementById('reg-password')
  input.type = input.type === 'password' ? 'text' : 'password'
}

function _checkPassword() {
  const value = document.getElementById('reg-password').value
  const checks = {
    longitud: value.length >= 8,
    mayus: /[A-Z]/.test(value) && /[a-z]/.test(value),
    especial: /[!@#$%^&*(),.?":{}|<>]/.test(value)
  }
  for (const [id, ok] of Object.entries(checks)) {
    document.getElementById(`ico-${id}`).textContent = ok ? '✅' : '❌'
    document.getElementById(`req-${id}`).style.color = ok ? '#16a34a' : '#9ca3af'
  }
  const todoOk = Object.values(checks).every(Boolean)
  const input = document.getElementById('reg-password')
  input.style.borderColor = todoOk ? '#16a34a' : (value.length ? '#f59e0b' : '')
  input.style.outline = todoOk ? '2px solid rgba(22,163,74,.25)' : ''
  document.getElementById('pwd-requisitos').style.display = todoOk ? 'none' : 'flex'
  _actualizarBtnRegistro()
}

function _actualizarBtnRegistro() {
  const value = document.getElementById('reg-password').value
  const passwordOk = value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[!@#$%^&*(),.?":{}|<>]/.test(value)
  const habilitado = passwordOk && document.getElementById('acepto-terminos')?.checked
  const boton = document.getElementById('btn-crear-cuenta')
  if (!boton) return
  boton.disabled = !habilitado
  boton.style.opacity = habilitado ? '1' : '0.5'
  boton.style.cursor = habilitado ? 'pointer' : 'not-allowed'
}

async function redirigirSegunRol(email) {
  const { data, error } = await db.from('usuarios').select('rol').eq('email', email).single()
  if (error || !data) return void (window.location.href = 'app.html')
  window.location.href = data.rol === 'admin' ? 'admin.html' : data.rol === 'repartidor' ? 'repartidor.html' : 'app.html'
}

async function loginEmail() {
  const email = document.getElementById('login-email').value
  const password = document.getElementById('login-password').value
  if (!email || !password) return showError('Llena todos los campos')
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (error) return showError('Correo o contraseña incorrectos')
  const { data: { session } } = await db.auth.getSession()
  if (session) db.from('eventos_trafico').insert({ tipo: 'login', user_id: session.user.id, tenant_id: tenantActualLogin?.id || null }).then(() => {})
  await redirigirSegunRol(email)
}

async function loginGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: urlDelTenant('/redirect.html'), queryParams: { prompt: 'select_account' } }
  })
  if (error) showError('Error con Google: ' + error.message)
}

function mostrarToastLogin(msg) {
  const toast = document.createElement('div')
  toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#22c55e;color:white;padding:16px 28px;border-radius:14px;font-family:Montserrat,sans-serif;font-weight:900;font-size:14px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.25);text-align:center'
  toast.textContent = msg
  document.body.appendChild(toast)
  setTimeout(() => { toast.style.transition = 'opacity .4s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400) }, 3000)
}

async function recuperarPassword() {
  const email = document.getElementById('forgot-email').value.trim()
  if (!email) return showError('Ingresa tu correo electrónico')
  const boton = document.querySelector('#forgot-form .btn-primary')
  boton.textContent = 'Enviando...'
  boton.disabled = true
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: urlDelTenant('/cambiar-password.html') })
  boton.textContent = 'Enviar link de recuperación'
  boton.disabled = false
  if (error) return showError('Error al enviar: ' + error.message)
  mostrarToastLogin('✅ Te enviamos un link a tu correo')
  setTimeout(showLogin, 3200)
}

async function registrar() {
  if (!tenantActualLogin && window.tenantConfigReady) tenantActualLogin = await window.tenantConfigReady
  const nombre = document.getElementById('reg-nombre').value.trim()
  const email = document.getElementById('reg-email').value.trim()
  const password = document.getElementById('reg-password').value
  const whatsapp = document.getElementById('reg-whatsapp').value.trim()
  const empresaCodigo = document.getElementById('reg-empresa-codigo').value.trim().toUpperCase()
  const referidoCodigo = document.getElementById('reg-referido').value.trim().toUpperCase()
  if (!document.getElementById('acepto-terminos')?.checked) return showError('⚠️ Debes aceptar los términos y condiciones para continuar')
  if (!nombre || !email || !password || !whatsapp) return showError('Llena todos los campos')
  if (nombre.length > 100 || !/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'\-]+$/.test(nombre)) return showError('El nombre solo puede contener letras y espacios, máximo 100 caracteres')
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[!@#$%^&*(),.?":{}|<>]/.test(password)) return showError('La contraseña no cumple los requisitos de seguridad')
  if (!/^\d{10}$/.test(whatsapp)) return showError('El WhatsApp debe tener exactamente 10 dígitos')
  const { data: duplicado } = await db.from('usuarios').select('id').eq('whatsapp', whatsapp).maybeSingle()
  if (duplicado) return showError('Este número de WhatsApp ya está registrado')
  if (empresaCodigo) {
    const { data: empresa } = await db.from('empresas_afiliadas').select('id').eq('codigo', empresaCodigo).eq('activa', true).maybeSingle()
    if (!empresa) return showError('Código de empresa no válido')
  }
  let referidoPor = null
  if (referidoCodigo) {
    const { data: referido } = await db.from('usuarios').select('user_id').eq('codigo_referido_propio', referidoCodigo).maybeSingle()
    if (!referido) return showError('Código de referido no válido')
    const { data: pedido } = await db.from('pedidos').select('id').eq('whatsapp', whatsapp).limit(1).maybeSingle()
    if (pedido) return showError('Este WhatsApp ya tiene pedidos registrados — el código de referido no aplica')
    referidoPor = referidoCodigo
  }
  const { data, error } = await db.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: urlDelTenant('/redirect.html'),
      data: { nombre, whatsapp, empresa_codigo: empresaCodigo || null, referido_por: referidoPor, tenant_id: tenantActualLogin?.id || null, tenant_nombre: tenantActualLogin?.nombre_app || tenantActualLogin?.nombre || 'GUEPACK Express' }
    }
  })
  if (error) return showError('Error al crear cuenta: ' + error.message)
  if (data?.user) {
    if (tenantActualLogin?.id) {
      const { error: errorTenant } = await db.from('usuarios').update({ tenant_id: tenantActualLogin.id }).eq('user_id', data.user.id)
      if (errorTenant) console.error('No se pudo asociar el usuario con el tenant:', errorTenant)
    }
    db.from('eventos_trafico').insert({ tipo: 'registro', user_id: data.user.id, tenant_id: tenantActualLogin?.id || null }).then(() => {})
  }
  _mostrarModalCuentaCreada()
}

function _mostrarModalCuentaCreada() {
  const overlay = document.createElement('div')
  overlay.id = 'modal-cuenta-creada'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px'
  overlay.innerHTML = `<div style="background:white;border-radius:20px;padding:32px 24px;max-width:360px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center"><div style="font-size:48px;margin-bottom:12px">✅</div><div style="font-family:Montserrat,sans-serif;font-weight:900;font-size:18px;color:#1a2740;margin-bottom:10px">¡Cuenta creada!</div><div style="font-family:Montserrat,sans-serif;font-size:13px;color:#6b7280;line-height:1.6;margin-bottom:24px">Revisa tu correo electrónico para confirmar tu cuenta antes de iniciar sesión.</div><button onclick="document.getElementById('modal-cuenta-creada').remove()" style="width:100%;padding:14px;border:none;border-radius:12px;background:var(--color-primary);color:white;font-family:Montserrat,sans-serif;font-weight:900;font-size:14px;cursor:pointer;letter-spacing:.5px">Entendido</button></div>`
  document.body.appendChild(overlay)
}

async function resendConfirmationEmail() {
  const email = document.getElementById('login-email').value.trim()
  if (!email) return showError('Ingresa tu correo para reenviar la confirmación')
  const { error } = await db.auth.resend({ type: 'signup', email })
  if (error) return showError('Error al reenviar: ' + error.message)
  showSuccess('✅ Correo de confirmación reenviado. Revisa tu bandeja de entrada.')
}

function initializeLoginPage() {
  window.addEventListener('tenant-config-aplicada', evento => aplicarBrandingLogin(evento.detail))
  window.tenantConfigReady?.then(aplicarBrandingLogin)
  const params = new URLSearchParams(window.location.search)
  if (params.get('error') !== 'email_no_verificado') return
  const error = document.getElementById('error-msg')
  error.innerHTML = '📧 Debes confirmar tu correo electrónico antes de iniciar sesión. Revisa tu bandeja de entrada.'
  error.style.display = 'block'
  document.getElementById('success-msg').style.display = 'none'
  const boton = document.createElement('button')
  boton.textContent = 'Reenviar correo de confirmación'
  boton.style.cssText = 'display:block;margin-top:10px;width:100%;padding:10px 0;border:none;border-radius:10px;background:var(--color-primary);color:white;font-family:Montserrat,sans-serif;font-weight:700;font-size:13px;cursor:pointer;letter-spacing:.3px'
  boton.onclick = resendConfirmationEmail
  error.appendChild(boton)
}
