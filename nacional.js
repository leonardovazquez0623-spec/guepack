// nacional.js — wizard de envíos nacionales vía Skydropx
// Depende de: db, SUPABASE_URL (globales de app.html), comparador-nacional.js

const NAC_TAMANOS = {
  sobre:        { largo: 35, ancho: 25, alto:  5 },
  caja_chica:   { largo: 30, ancho: 20, alto: 15 },
  caja_mediana: { largo: 45, ancho: 35, alto: 30 },
  caja_grande:  { largo: 60, ancho: 50, alto: 40 },
  personalizado: null,
}

let _nacStep         = 1
let _nacEnvioId      = null
let _nacCpOrigen     = null
let _nacCpDestino    = null
let _nacCotizacionTs = null
let _nacPesoKg       = 0
let _nacLargoCm      = 0
let _nacAnchoCm      = 0
let _nacAltoCm       = 0

let _nacColoniaOrigen    = null
let _nacEstadoOrigen     = null
let _nacMunicipioOrigen  = null
let _nacColoniaDestino   = null
let _nacEstadoDestino    = null
let _nacMunicipioDestino = null
const _nacCpCache        = { origen: null, destino: null }

// Polígono GDL-ZPN: null=pendiente, true/false=resultado

// ── Navegación ───────────────────────────────────────────────────────────────

function nacShowStep(n) {
  _nacStep = n
  ;[1, 2, 3].forEach(i => {
    const step = document.getElementById('nac-step-' + i)
    if (step) step.style.display = i === n ? '' : 'none'
    const dot = document.getElementById('nac-wp-' + i)
    if (dot) {
      dot.classList.remove('active', 'done')
      if (i < n) dot.classList.add('done')
      else if (i === n) dot.classList.add('active')
    }
  })
  ;[1, 2].forEach(i => {
    const line = document.getElementById('nac-wl-' + i)
    if (line) {
      if (i < n) line.classList.add('done')
      else line.classList.remove('done')
    }
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ── Paso 1: Cotizador rápido ─────────────────────────────────────────────────

function _nacOnTamanoChange(key, btn) {
  document.querySelectorAll('.nac-tamano-chip').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  const customDiv = document.getElementById('nac-dims-custom')
  if (key === 'personalizado') {
    customDiv.style.display = ''
    ;['nac-paso1-largo','nac-paso1-ancho','nac-paso1-alto'].forEach(id => {
      document.getElementById(id).value = ''
    })
  } else {
    customDiv.style.display = 'none'
  }
}

async function nacCotizarRapido() {
  const cpOri  = document.getElementById('nac-cp-origen').value.trim()
  const cpDst  = document.getElementById('nac-cp-destino').value.trim()
  const peso   = parseFloat(document.getElementById('nac-paso1-peso').value) || 0
  const chip   = document.querySelector('.nac-tamano-chip.active')
  const tamano = chip?.dataset?.tamano

  if (!/^\d{5}$/.test(cpOri)) {
    mostrarToast('⚠️ El CP de origen debe ser exactamente 5 dígitos numéricos', 'var(--orange)')
    return
  }
  if (!/^\d{5}$/.test(cpDst)) {
    mostrarToast('⚠️ El CP de destino debe ser exactamente 5 dígitos numéricos', 'var(--orange)')
    return
  }
  if (!_nacColoniaOrigen) {
    mostrarToast('⚠️ Selecciona la colonia de origen para cotizar', 'var(--orange)')
    return
  }
  if (!_nacColoniaDestino) {
    mostrarToast('⚠️ Selecciona la colonia de destino para cotizar', 'var(--orange)')
    return
  }
  if (!peso || peso <= 0) {
    mostrarToast('⚠️ El peso debe ser mayor a 0 kg', 'var(--orange)')
    return
  }
  if (!tamano) {
    mostrarToast('⚠️ Selecciona el tamaño del paquete', 'var(--orange)')
    return
  }

  let largo, ancho, alto
  if (tamano === 'personalizado') {
    largo = parseFloat(document.getElementById('nac-paso1-largo').value) || 0
    ancho = parseFloat(document.getElementById('nac-paso1-ancho').value) || 0
    alto  = parseFloat(document.getElementById('nac-paso1-alto').value)  || 0
    if (largo <= 0) { mostrarToast('⚠️ Ingresa el largo del paquete', 'var(--orange)'); return }
    if (ancho <= 0) { mostrarToast('⚠️ Ingresa el ancho del paquete', 'var(--orange)'); return }
    if (alto  <= 0) { mostrarToast('⚠️ Ingresa el alto del paquete',  'var(--orange)'); return }
  } else {
    const preset = NAC_TAMANOS[tamano]
    largo = preset.largo; ancho = preset.ancho; alto = preset.alto
  }

  // Guarda dims para el INSERT final (usadas cuando se confirma en Paso 3)
  _nacPesoKg = peso; _nacLargoCm = largo; _nacAnchoCm = ancho; _nacAltoCm = alto

  const btn = document.getElementById('nac-btn-cotizar')
  btn.disabled = true
  btn.textContent = '⏳ Cotizando...'

  const comp = document.getElementById('comparador-envios')
  comp.style.display = 'none'
  comp.innerHTML = ''
  document.getElementById('nac-confirmacion-panel')?.remove()
  opcionSeleccionada  = null
  extrasSeleccionados = new Set()

  const origen  = { cp: cpOri, colonia: _nacColoniaOrigen,  estado: _nacEstadoOrigen,  ciudad: _nacMunicipioOrigen }
  const destino = { cp: cpDst, colonia: _nacColoniaDestino, estado: _nacEstadoDestino, ciudad: _nacMunicipioDestino }
  const paquete = { peso_kg: peso, largo_cm: largo, ancho_cm: ancho, alto_cm: alto, contenido: 'Paquete' }

  try {
    await cotizarEnvio(origen, destino, paquete)
    comp.style.display = ''
  } catch (err) {
    mostrarToast(err.message, '#ef4444')
  } finally {
    btn.disabled = false
    btn.textContent = '🔍 Cotizar'
  }
}

function _nacConfirmarOpcion(idx) {
  document.getElementById('nac-confirmacion-panel')?.remove()
  document.querySelectorAll('.opcion-envio').forEach(c => c.classList.remove('seleccionada'))
  document.querySelectorAll('.opcion-envio')[idx]?.classList.add('seleccionada')

  const overlay = document.createElement('div')
  overlay.id = 'nac-confirmacion-panel'
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999',
    'background:rgba(0,0,0,0.55)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:20px',
  ].join(';')

  overlay.innerHTML = `
    <div style="
      background:#fff; border-radius:20px; padding:28px 24px;
      width:100%; max-width:380px; text-align:center;
      box-shadow:0 20px 60px rgba(0,0,0,0.25);
    ">
      <div style="font-size:38px;margin-bottom:12px;line-height:1">⚠️</div>
      <div style="
        font-family:Montserrat,sans-serif; font-size:16px; font-weight:900;
        color:#111; margin-bottom:10px;
      ">¿Confirmar esta opción?</div>
      <div style="
        font-family:Montserrat,sans-serif; font-size:13px; color:#666;
        line-height:1.65; margin-bottom:24px;
      ">
        Este precio quedará fijo en tu cotización. Si necesitas cambiar el
        CP de origen o destino, tendrás que cotizar de nuevo y el precio
        puede variar.
      </div>
      <div style="display:flex;gap:10px">
        <button id="nac-modal-cancelar" style="
          flex:1; padding:13px; border:1.5px solid #ccc; border-radius:12px;
          background:#fff; color:#555;
          font-family:Montserrat,sans-serif; font-weight:700; font-size:13px;
          cursor:pointer;
        ">Cancelar</button>
        <button id="nac-modal-confirmar" style="
          flex:2; padding:13px; border:none; border-radius:12px;
          background:#1E56C7; color:#fff;
          font-family:Montserrat,sans-serif; font-weight:900; font-size:13px;
          cursor:pointer;
        ">Confirmar y continuar →</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  document.getElementById('nac-modal-cancelar').addEventListener('click', () => {
    overlay.remove()
    document.querySelectorAll('.opcion-envio').forEach(c => c.classList.remove('seleccionada'))
  })
  document.getElementById('nac-modal-confirmar').addEventListener('click', () => {
    overlay.remove()
    _nacAplicarSeleccion(idx)
  })
}

function _nacAplicarSeleccion(idx) {
  opcionSeleccionada = cotizacionActual.opciones[idx]
  _nacCpOrigen       = document.getElementById('nac-cp-origen').value.trim()
  _nacCpDestino      = document.getElementById('nac-cp-destino').value.trim()
  _nacCotizacionTs   = Date.now()

  document.getElementById('nac-confirmacion-panel')?.remove()

  // Pre-rellena los CP bloqueados en Paso 2 antes de mostrar el paso
  const oriCpEl = document.getElementById('nac-ori-cp')
  const dstCpEl = document.getElementById('nac-dst-cp')
  if (oriCpEl) oriCpEl.value = _nacCpOrigen
  if (dstCpEl) dstCpEl.value = _nacCpDestino

  // Pre-rellena colonia/ciudad/estado bloqueados desde el Paso 1
  const _f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || '' }
  _f('nac-ori-colonia', _nacColoniaOrigen);  _f('nac-ori-ciudad', _nacMunicipioOrigen);  _f('nac-ori-estado', _nacEstadoOrigen)
  _f('nac-dst-colonia', _nacColoniaDestino); _f('nac-dst-ciudad', _nacMunicipioDestino); _f('nac-dst-estado', _nacEstadoDestino)

  nacShowStep(2)
}

// ── Paso 2: Direcciones ───────────────────────────────────────────────────────

function _nacValidarPaso2() {
  const required = [
    ['nac-ori-nombre', 'el nombre de origen'],
    ['nac-ori-tel',    'el teléfono de origen'],
    ['nac-ori-calle',  'la calle de origen'],
    ['nac-dst-nombre', 'el nombre del destinatario'],
    ['nac-dst-tel',    'el teléfono de destino'],
    ['nac-dst-calle',  'la calle de destino'],
  ]
  for (const [id, label] of required) {
    const el = document.getElementById(id)
    if (!el?.value?.trim()) {
      mostrarToast('⚠️ Ingresa ' + label, 'var(--orange)')
      el?.focus()
      return false
    }
  }
  if (!document.getElementById('nac-tipo-contenido').value) {
    mostrarToast('⚠️ Selecciona el tipo de contenido', 'var(--orange)')
    return false
  }
  return true
}

async function nacSiguiente(desde) {
  if (desde === 2) {
    if (!_nacValidarPaso2()) return
    if (!_nacVerificarExpiracion()) return
    nacShowStep(3)
    renderUpsell()
    _nacRenderResumen()
  }
}

function _nacVerificarExpiracion() {
  if (!_nacCotizacionTs) {
    mostrarToast('⏰ Sin cotización válida, regresa al Paso 1', '#ef4444')
    nacShowStep(1)
    return false
  }
  const horas = (Date.now() - _nacCotizacionTs) / 3_600_000
  if (horas > 20) {
    mostrarToast('⏰ Tu cotización expiró (más de 20 h). Vuelve a cotizar.', '#ef4444')
    nacShowStep(1)
    return false
  }
  return true
}

function _nacGetOrigen() {
  return {
    nombre:     document.getElementById('nac-ori-nombre').value.trim(),
    telefono:   document.getElementById('nac-ori-tel').value.trim(),
    email:      document.getElementById('nac-ori-email').value.trim() || null,
    calle:      document.getElementById('nac-ori-calle').value.trim(),
    numero:     document.getElementById('nac-ori-num').value.trim() || null,
    colonia:    document.getElementById('nac-ori-colonia').value.trim(),
    ciudad:     document.getElementById('nac-ori-ciudad').value.trim(),
    estado:     document.getElementById('nac-ori-estado').value.trim(),
    referencia: document.getElementById('nac-ori-ref').value.trim() || null,
  }
}

function _nacGetDestino() {
  return {
    nombre:     document.getElementById('nac-dst-nombre').value.trim(),
    telefono:   document.getElementById('nac-dst-tel').value.trim(),
    email:      document.getElementById('nac-dst-email').value.trim() || null,
    calle:      document.getElementById('nac-dst-calle').value.trim(),
    numero:     document.getElementById('nac-dst-num').value.trim() || null,
    colonia:    document.getElementById('nac-dst-colonia').value.trim(),
    ciudad:     document.getElementById('nac-dst-ciudad').value.trim(),
    estado:     document.getElementById('nac-dst-estado').value.trim(),
    referencia: document.getElementById('nac-dst-ref').value.trim() || null,
  }
}

// ── Paso 3: Pago ─────────────────────────────────────────────────────────────

// Llamada por el botón del upsell: actualiza total con extras y refresca resumen
function _nacActualizarResumenConExtras() {
  _nacRenderResumen()
  document.getElementById('nac-resumen')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function _nacRenderResumen() {
  if (!opcionSeleccionada) return
  const ori = _nacGetOrigen()
  const dst = _nacGetDestino()
  let costoExtras = 0
  extrasSeleccionados.forEach(k => { costoExtras += EXTRAS[k].costo })
  const total = opcionSeleccionada.costo + costoExtras

  document.getElementById('nac-resumen').innerHTML = `
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--gray-mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Origen</div>
      <div style="font-size:13px;font-weight:700;font-family:Montserrat,sans-serif">${ori.nombre} · ${ori.telefono}</div>
      <div style="font-size:12px;color:var(--gray-mid);font-family:Montserrat,sans-serif">${ori.calle}${ori.numero ? ' ' + ori.numero : ''}, ${ori.colonia}, ${ori.ciudad}, ${ori.estado} CP ${_nacCpOrigen}</div>
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--gray-mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Destino</div>
      <div style="font-size:13px;font-weight:700;font-family:Montserrat,sans-serif">${dst.nombre} · ${dst.telefono}</div>
      <div style="font-size:12px;color:var(--gray-mid);font-family:Montserrat,sans-serif">${dst.calle}${dst.numero ? ' ' + dst.numero : ''}, ${dst.colonia}, ${dst.ciudad}, ${dst.estado} CP ${_nacCpDestino}</div>
    </div>
    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--gray-mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Paquete</div>
      <div style="font-size:12px;color:var(--gray-mid);font-family:Montserrat,sans-serif">${_nacPesoKg} kg · ${_nacLargoCm}×${_nacAnchoCm}×${_nacAltoCm} cm</div>
    </div>
    <div style="border-top:1.5px solid var(--gray);padding-top:14px;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--gray-mid);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Paquetería</div>
      <div style="font-size:14px;font-weight:700;font-family:Montserrat,sans-serif">${opcionSeleccionada.medalla} ${nombrePaqueteria(opcionSeleccionada.paqueteria)}</div>
      <div style="font-size:12px;color:var(--gray-mid);font-family:Montserrat,sans-serif">${opcionSeleccionada.servicio || ''} · ${formatearDias(opcionSeleccionada.dias_min, opcionSeleccionada.dias_max)}</div>
    </div>
    <div style="border-top:1.5px solid var(--gray);padding-top:14px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-family:Montserrat,sans-serif;font-size:14px;font-weight:700;color:var(--blue)">Total a pagar</span>
      <span style="font-family:Montserrat,sans-serif;font-size:24px;font-weight:900;color:var(--orange)">$${total.toFixed(0)}</span>
    </div>
  `
}

async function nacConfirmarEnvioFinal() {
  if (!_nacVerificarExpiracion()) return

  const btn = document.getElementById('nac-btn-confirmar')
  btn.disabled = true
  btn.textContent = '⏳ Procesando...'

  try {
    const { data: { session } } = await db.auth.getSession()
    if (!session) { mostrarToast('Sesión expirada, recarga la página', '#ef4444'); return }

    const tipoContenido = document.getElementById('nac-tipo-contenido').value

    const res = await fetch(`${SUPABASE_URL}/functions/v1/skydropx-confirmar-envio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        quotation_id: cotizacionActual.quotation_id,
        rate_id:      opcionSeleccionada.rate_id,
        direcciones: {
          origen:     _nacGetOrigen(),
          destino:    _nacGetDestino(),
          cp_origen:  _nacCpOrigen,
          cp_destino: _nacCpDestino,
        },
        paquete: {
          peso_kg:  _nacPesoKg,  largo_cm: _nacLargoCm,
          ancho_cm: _nacAnchoCm, alto_cm:  _nacAltoCm,
          contenido: tipoContenido,
        },
        extras_seleccionados: Array.from(extrasSeleccionados),
      }),
    })

    const result = await res.json()
    if (!res.ok) { mostrarToast(result.error || 'Error al confirmar el envío', '#ef4444'); return }

    _nacEnvioId = result.envio_id

    btn.textContent = '⏳ Generando link de pago...'
    const pagoRes = await fetch(`${SUPABASE_URL}/functions/v1/conekta-crear-pago`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ envio_id: result.envio_id }),
    })
    const pagoJson = await pagoRes.json()
    if (!pagoRes.ok) {
      mostrarToast(pagoJson.error || 'Error al generar el link de pago', '#ef4444')
      return
    }

    window.location.href = pagoJson.checkout_url

  } catch (e) {
    mostrarToast('Error inesperado: ' + e.message, '#ef4444')
  } finally {
    btn.disabled = false
    btn.textContent = 'Confirmar envío'
  }
}

// ── Selector de colonias por CP ──────────────────────────────────────────────

let _nacCpDrop     = null  // div singleton (reutilizado entre los dos CP)
let _nacCpDropTipo = null  // 'origen' | 'destino' — cuál está activo

function _nacStatusEl(tipo) {
  return document.getElementById('nac-' + tipo + '-cp-status')
}

function _nacCerrarDrop() {
  if (_nacCpDrop) _nacCpDrop.style.display = 'none'
  _nacCpDropTipo = null
}

function _nacPosicionarDrop(inputEl) {
  if (!_nacCpDrop) {
    _nacCpDrop = document.createElement('div')
    _nacCpDrop.className = 'guep-ac-dropdown'
    document.body.appendChild(_nacCpDrop)
  }
  const r = inputEl.getBoundingClientRect()
  _nacCpDrop.style.top   = (r.bottom + window.scrollY + 2) + 'px'
  _nacCpDrop.style.left  = (r.left   + window.scrollX)     + 'px'
  _nacCpDrop.style.width = r.width + 'px'
}

function _nacMostrarColonias(tipo, colonias, estado, municipio, inputEl) {
  _nacCpDropTipo = tipo
  _nacPosicionarDrop(inputEl)
  _nacCpDrop.innerHTML = colonias.map((c, i) =>
    `<div class="guep-ac-item" data-idx="${i}">
      <div class="guep-ac-item-main">${c}</div>
      <div class="guep-ac-item-sub">${municipio}, ${estado}</div>
    </div>`
  ).join('')
  _nacCpDrop.querySelectorAll('.guep-ac-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.classList.add('activo'))
    el.addEventListener('mouseleave', () => el.classList.remove('activo'))
    el.addEventListener('mousedown',  e => { e.preventDefault(); _nacElegirColonia(tipo, colonias[+el.dataset.idx], estado, municipio) })
    el.addEventListener('touchend',   e => { e.preventDefault(); _nacElegirColonia(tipo, colonias[+el.dataset.idx], estado, municipio) })
  })
  _nacCpDrop.style.display = 'block'
}

function _nacElegirColonia(tipo, colonia, estado, municipio) {
  _nacCerrarDrop()
  if (tipo === 'origen') {
    _nacColoniaOrigen   = colonia
    _nacEstadoOrigen    = estado
    _nacMunicipioOrigen = municipio
  } else {
    _nacColoniaDestino   = colonia
    _nacEstadoDestino    = estado
    _nacMunicipioDestino = municipio
  }
  const statusEl = _nacStatusEl(tipo)
  if (!statusEl) return
  statusEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px;padding:7px 10px;
                background:rgba(26,79,160,0.06);border-radius:8px;border:1px solid rgba(26,79,160,0.15)">
      <span style="font-size:12px;font-weight:700;color:var(--blue);flex:1;font-family:Montserrat,sans-serif">🏘 ${colonia}</span>
      <button type="button"
        onclick="_nacRestablecerColonia('${tipo}')"
        style="font-size:10px;font-weight:700;color:var(--blue);background:none;border:none;
               cursor:pointer;padding:0;text-decoration:underline;flex-shrink:0;font-family:Montserrat,sans-serif">
        cambiar
      </button>
    </div>`
}

function _nacRestablecerColonia(tipo) {
  if (tipo === 'origen') {
    _nacColoniaOrigen = null; _nacEstadoOrigen = null; _nacMunicipioOrigen = null
  } else {
    _nacColoniaDestino = null; _nacEstadoDestino = null; _nacMunicipioDestino = null
  }
  const statusEl = _nacStatusEl(tipo)
  if (statusEl) statusEl.innerHTML = ''
  const cached  = _nacCpCache[tipo]
  const inputEl = document.getElementById(tipo === 'origen' ? 'nac-cp-origen' : 'nac-cp-destino')
  if (cached && inputEl) {
    _nacMostrarColonias(tipo, cached.colonias, cached.estado, cached.municipio, inputEl)
  }
}

async function _nacConsultarColonias(cp, tipo) {
  const statusEl = _nacStatusEl(tipo)
  const inputEl  = document.getElementById(tipo === 'origen' ? 'nac-cp-origen' : 'nac-cp-destino')
  if (!inputEl) return

  if (statusEl) statusEl.innerHTML = `<div style="font-size:11px;color:var(--gray-mid);font-weight:600;margin-top:5px;font-family:Montserrat,sans-serif">⏳ Buscando colonias...</div>`

  try {
    const res  = await fetch(`${SUPABASE_URL}/functions/v1/postalia-colonias`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_KEY },
      body:    JSON.stringify({ cp }),
    })
    const data = await res.json()
    if (!res.ok || !data.colonias?.length) {
      if (statusEl) statusEl.innerHTML = `<div style="font-size:11px;color:#ef4444;font-weight:600;margin-top:5px;font-family:Montserrat,sans-serif">CP no encontrado, verifica que esté bien escrito</div>`
      return
    }
    if (statusEl) statusEl.innerHTML = ''
    _nacCpCache[tipo] = { colonias: data.colonias, estado: data.estado, municipio: data.municipio }
    _nacMostrarColonias(tipo, data.colonias, data.estado, data.municipio, inputEl)
  } catch {
    if (statusEl) statusEl.innerHTML = `<div style="font-size:11px;color:#ef4444;font-weight:600;margin-top:5px;font-family:Montserrat,sans-serif">Error al consultar el CP, intenta de nuevo</div>`
  }
}

function nacIniciarCpListeners() {
  ;[['nac-cp-origen', 'origen'], ['nac-cp-destino', 'destino']].forEach(([inputId, tipo]) => {
    const input = document.getElementById(inputId)
    if (!input || input.dataset.cpListenerAttached) return
    input.dataset.cpListenerAttached = '1'
    let _timer = null
    input.addEventListener('input', () => {
      const val = input.value.trim()
      clearTimeout(_timer)
      // Resetea inmediatamente al editar — invalida colonia previa y borra el pill
      if (tipo === 'origen') {
        _nacColoniaOrigen = null; _nacEstadoOrigen = null; _nacMunicipioOrigen = null
      } else {
        _nacColoniaDestino = null; _nacEstadoDestino = null; _nacMunicipioDestino = null
      }
      _nacCpCache[tipo] = null
      _nacCerrarDrop()
      const statusEl = _nacStatusEl(tipo)
      if (statusEl) statusEl.innerHTML = ''
      if (/^\d{5}$/.test(val)) {
        _timer = setTimeout(() => _nacConsultarColonias(val, tipo), 400)
      }
    })
    input.addEventListener('blur', () => setTimeout(_nacCerrarDrop, 150))
  })
}

// ── Reset ────────────────────────────────────────────────────────────────────

function nacReset() {
  const ids = [
    'nac-cp-origen','nac-cp-destino','nac-paso1-peso',
    'nac-paso1-largo','nac-paso1-ancho','nac-paso1-alto',
    'nac-ori-nombre','nac-ori-tel','nac-ori-email','nac-ori-calle','nac-ori-num',
    'nac-ori-colonia','nac-ori-ciudad','nac-ori-estado','nac-ori-cp','nac-ori-ref',
    'nac-dst-nombre','nac-dst-tel','nac-dst-email','nac-dst-calle','nac-dst-num',
    'nac-dst-colonia','nac-dst-ciudad','nac-dst-estado','nac-dst-cp','nac-dst-ref',
    'nac-tipo-contenido',
  ]
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })

  document.querySelectorAll('.nac-tamano-chip').forEach(b => b.classList.remove('active'))
  const customDiv = document.getElementById('nac-dims-custom')
  if (customDiv) customDiv.style.display = 'none'

  cotizacionActual    = null
  opcionSeleccionada  = null
  extrasSeleccionados = new Set()

  const comp = document.getElementById('comparador-envios')
  if (comp) { comp.style.display = 'none'; comp.innerHTML = '' }
  const ups = document.getElementById('upsell-envios')
  if (ups)  ups.innerHTML = ''
  document.getElementById('nac-confirmacion-panel')?.remove()

  const sc = document.getElementById('nac-success')
  if (sc)  sc.style.display = 'none'
  const rs = document.getElementById('nac-resumen')
  if (rs)  rs.innerHTML = ''

  _nacEnvioId = _nacCpOrigen = _nacCpDestino = _nacCotizacionTs = null
  _nacPesoKg  = _nacLargoCm = _nacAnchoCm   = _nacAltoCm       = 0

  _nacColoniaOrigen = _nacEstadoOrigen = _nacMunicipioOrigen = null
  _nacColoniaDestino = _nacEstadoDestino = _nacMunicipioDestino = null
  _nacCpCache.origen = _nacCpCache.destino = null
  _nacCerrarDrop()
  const _s1 = document.getElementById('nac-origen-cp-status')
  const _s2 = document.getElementById('nac-destino-cp-status')
  if (_s1) _s1.innerHTML = ''
  if (_s2) _s2.innerHTML = ''

  nacShowStep(1)
}
