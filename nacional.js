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

  // Skydropx solo necesita CP para cotizar; ciudad/estado/colonia pueden ser vacíos
  const origen  = { cp: cpOri, estado: '', ciudad: '', colonia: '' }
  const destino = { cp: cpDst, estado: '', ciudad: '', colonia: '' }
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

  nacShowStep(2)
}

// ── Paso 2: Direcciones ───────────────────────────────────────────────────────

function _nacValidarPaso2() {
  const required = [
    ['nac-ori-nombre',  'el nombre de origen'],
    ['nac-ori-tel',     'el teléfono de origen'],
    ['nac-ori-calle',   'la calle de origen'],
    ['nac-ori-colonia', 'la colonia de origen'],
    ['nac-ori-ciudad',  'la ciudad de origen'],
    ['nac-ori-estado',  'el estado de origen'],
    ['nac-dst-nombre',  'el nombre del destinatario'],
    ['nac-dst-tel',     'el teléfono de destino'],
    ['nac-dst-calle',   'la calle de destino'],
    ['nac-dst-colonia', 'la colonia de destino'],
    ['nac-dst-ciudad',  'la ciudad de destino'],
    ['nac-dst-estado',  'el estado de destino'],
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

function nacSiguiente(desde) {
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
      <div style="font-size:14px;font-weight:700;font-family:Montserrat,sans-serif">${opcionSeleccionada.medalla} ${opcionSeleccionada.paqueteria}</div>
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

  nacShowStep(1)
}
