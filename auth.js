let tenantActualLogin = null
let _regWhatsappVerificado = false
let _regConfirmationResult = null
let _regCooldownTimer = null

const FIREBASE_CONFIG_GUEPACK = {
  apiKey: 'AIzaSyBG3EDbiS-0uswcGGBN9NyrlzpyJFOGnKo',
  authDomain: 'guepack-app.firebaseapp.com',
  projectId: 'guepack-app',
  storageBucket: 'guepack-app.firebasestorage.app',
  messagingSenderId: '912683525841',
  appId: '1:912683525841:web:a67f014362160ea29b87f0'
}

function _firebaseAuthGuepack() {
  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG_GUEPACK)
  return firebase.auth()
}

async function limpiarRecaptcha() {
  if (window._appVerifier) {
    try { window._appVerifier.clear() } catch (error) { console.warn('clear error:', error) }
    window._appVerifier = null
  }

  const container = document.getElementById('recaptcha-container')
  if (container) container.replaceChildren()
}

async function enviarCodigoSMS(whatsapp) {
  const boton = document.getElementById('btn-enviar-codigo')

  // PASO 1: validar duplicado antes de crear reCAPTCHA o llamar a Firebase.
  const { data: { session } } = await db.auth.getSession()
  let consultaDuplicado = db.from('usuarios')
    .select('user_id')
    .eq('whatsapp', whatsapp)
  if (session?.user?.id) consultaDuplicado = consultaDuplicado.neq('user_id', session.user.id)
  const { data: whatsappExistente, error: errorConsulta } = await consultaDuplicado.maybeSingle()
  if (errorConsulta) console.warn('[WhatsApp] No se pudo consultar duplicado:', errorConsulta.message)
  if (whatsappExistente) {
    showError('⚠️ Este número de WhatsApp ya está registrado en otra cuenta')
    const errorEl = document.getElementById('reg-sms-error')
    if (errorEl) {
      errorEl.innerHTML = '<img src="/guepack-icons/guepack-icons/svg/38-seguridad.svg" alt="" width="20" style="vertical-align:middle;margin-right:6px">Este número de WhatsApp ya está registrado en otra cuenta'
      errorEl.style.display = 'block'
    }
    return null
  }

  // PASO 2: únicamente si no existe un duplicado, intentar Firebase SMS.
  try {
    if (boton) boton.disabled = true
    await limpiarRecaptcha()

    window._appVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      size: 'invisible',
      callback: () => console.log('[recaptcha] resuelto'),
      'expired-callback': () => console.warn('[recaptcha] expirado')
    })

    await window._appVerifier.render()

    const telefono = '+52' + whatsapp.replace(/\D/g, '')
    console.log('[SMS] enviando a:', telefono)

    window.confirmationResult = await firebase.auth().signInWithPhoneNumber(telefono, window._appVerifier)
    console.log('[SMS] código enviado correctamente')
    return window.confirmationResult
  } catch (error) {
    console.error('[SMS] error:', error.code, error.message)
    await limpiarRecaptcha()
    throw error
  } finally {
    if (boton) boton.disabled = false
  }
}

function _mensajeErrorSms(error) {
  return ['auth/too-many-requests', 'auth/quota-exceeded'].includes(error?.code)
    ? 'Demasiados intentos, espera un momento'
    : '❌ Código incorrecto, intenta de nuevo'
}

function _regMostrarErrorSms(error) {
  const el = document.getElementById('reg-sms-error')
  if (!el) return
  el.innerHTML = '<img src="/guepack-icons/guepack-icons/svg/38-seguridad.svg" alt="" width="20" style="vertical-align:middle;margin-right:6px">No pudimos verificar tu WhatsApp por SMS. Intenta de nuevo en un momento.'
  el.style.display = 'block'
  mostrarToastLogin('❌ No pudimos verificar tu WhatsApp por SMS. Intenta de nuevo en un momento.', 'error')
}

function _regIniciarCooldown() {
  clearInterval(_regCooldownTimer)
  let segundos = 60
  const btn = document.getElementById('reg-btn-reenviar')
  btn.disabled = true
  btn.textContent = `Reenviar código en ${segundos}s`
  _regCooldownTimer = setInterval(() => {
    segundos--
    btn.textContent = segundos > 0 ? `Reenviar código en ${segundos}s` : 'Reenviar código'
    if (segundos <= 0) { clearInterval(_regCooldownTimer); btn.disabled = false }
  }, 1000)
}

async function _regEnviarCodigo() {
  const input = document.getElementById('reg-whatsapp')
  const whatsapp = input.value.replace(/\D/g, '')
  if (!/^\d{10}$/.test(whatsapp)) return showError('El WhatsApp debe tener exactamente 10 dígitos')
  const btn = document.getElementById('btn-enviar-codigo')
  btn.disabled = true
  btn.textContent = 'Enviando...'
  document.getElementById('reg-sms-error').style.display = 'none'
  try {
    const confirmationResult = await enviarCodigoSMS(whatsapp)
    if (!confirmationResult) {
      btn.disabled = false
      btn.textContent = 'Enviar código'
      return
    }
    _regConfirmationResult = confirmationResult
    document.getElementById('reg-sms-error').style.display = 'none'
    input.readOnly = true
    input.style.borderColor = '#16a34a'
    document.getElementById('reg-whatsapp-check').style.display = 'block'
    btn.style.display = 'none'
    document.getElementById('reg-otp-wrap').style.display = 'block'
    document.getElementById('reg-codigo').focus()
    _regIniciarCooldown()
  } catch (error) {
    btn.disabled = false
    btn.textContent = 'Enviar código'
    _regMostrarErrorSms(error)
  }
}

async function _regReenviarCodigo() {
  const whatsapp = document.getElementById('reg-whatsapp').value.replace(/\D/g, '')
  try {
    const confirmationResult = await enviarCodigoSMS(whatsapp)
    if (!confirmationResult) return
    _regConfirmationResult = confirmationResult
    _regIniciarCooldown()
  } catch (error) { _regMostrarErrorSms(error) }
}

async function _regVerificarCodigo() {
  const code = document.getElementById('reg-codigo').value.replace(/\D/g, '')
  if (!/^\d{6}$/.test(code)) return _regMostrarErrorSms({ code: 'auth/invalid-verification-code' })
  const btn = document.getElementById('reg-btn-verificar')
  btn.disabled = true
  try {
    const result = await window.confirmationResult.confirm(code)
    await _firebaseAuthGuepack().signOut()
    _regWhatsappVerificado = true
    document.getElementById('reg-otp-wrap').style.display = 'none'
    document.getElementById('reg-verificado-badge').style.display = 'block'
    document.getElementById('reg-whatsapp').style.background = '#dcfce7'
    clearInterval(_regCooldownTimer)
    _actualizarBtnRegistro()
  } catch (error) { btn.disabled = false; _regMostrarErrorSms(error) }
}

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
  const habilitado = passwordOk && _regWhatsappVerificado && document.getElementById('acepto-terminos')?.checked
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

function mostrarToastLogin(msg, tipo = 'success') {
  const toast = document.createElement('div')
  const color = tipo === 'error' ? '#dc2626' : '#22c55e'
  toast.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:${color};color:white;padding:16px 28px;border-radius:14px;font-family:Montserrat,sans-serif;font-weight:900;font-size:14px;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.25);text-align:center`
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
  if (!_regWhatsappVerificado) return showError('Debes verificar tu WhatsApp antes de continuar')
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
      data: { nombre, whatsapp, whatsapp_verificado: true, empresa_codigo: empresaCodigo || null, referido_por: referidoPor, tenant_id: tenantActualLogin?.id || null, tenant_nombre: tenantActualLogin?.nombre_app || tenantActualLogin?.nombre || 'GUEPACK Express' }
    }
  })
  if (error) return showError('Error al crear cuenta: ' + error.message)
  if (data?.user) {
    if (tenantActualLogin?.id) {
      const { error: errorTenant } = await db.from('usuarios').update({ tenant_id: tenantActualLogin.id, whatsapp, whatsapp_verificado: true }).eq('user_id', data.user.id)
      if (errorTenant) console.error('No se pudo asociar el usuario con el tenant:', errorTenant)
    } else {
      const { error: errorVerificado } = await db.from('usuarios').update({ whatsapp, whatsapp_verificado: true }).eq('user_id', data.user.id)
      if (errorVerificado) console.error('No se pudo guardar la verificación de WhatsApp:', errorVerificado)
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
