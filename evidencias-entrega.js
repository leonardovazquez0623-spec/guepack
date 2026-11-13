/* Aviso por entrada a la app. No guarda descartes ni URLs privadas en storage. */
window.GuepEvidencias = (() => {
  const AVISO = 'Tienes evidencias de entregas de hace 30 días o más. Al descargarlas, se eliminarán de GUEPAPP. Guarda el archivo ZIP para conservarlas.'
  let options, summary = { elegibles: 0, lotes: [] }, identity, busy = false
  let started = false, checking = false, dismissed = false, hidden = false, epoch = 0
  let dialog, timer, requestKey, previousFocus

  function close() {
    dismissed = true
    if (dialog) { dialog.close(); dialog.remove(); dialog = null }
    previousFocus?.focus?.()
  }
  function clear() {
    epoch++; clearTimeout(timer); close(); identity = null; requestKey = null
    summary = { elegibles: 0, lotes: [] }; renderPanel()
  }
  async function session() {
    await window.tenantConfigReady
    const { data: { user }, error } = await options.db.auth.getUser()
    const tenant = window.tenantConfig?.id
    if (error || !user || user.is_anonymous || !user.email_confirmed_at || !tenant) {
      clear(); return null
    }
    const next = `${user.id}:${tenant}`
    if (identity && identity !== next) clear()
    identity = next
    return { tenant, identity: next }
  }
  async function call(body) {
    const current = await session()
    if (!current) throw new Error('Inicia sesión para descargar tus evidencias.')
    const version = epoch
    const { data, error } = await options.db.functions.invoke('evidencias-entrega', {
      body: { ...body, tenant_id: current.tenant }
    })
    if (version !== epoch || identity !== current.identity) throw new Error('La sesión cambió.')
    if (error || data?.error) throw new Error('No se pudo completar. Tus evidencias pendientes se conservan; puedes reintentar.')
    return data
  }
  function button(text, action, primary = false) {
    const el = document.createElement('button')
    el.type = 'button'; el.className = primary ? 'btn btn-primary' : 'btn-evidencias'
    el.textContent = text; el.disabled = busy; el.onclick = action
    return el
  }
  function message(text) {
    const el = document.createElement('p'); el.textContent = text; return el
  }
  function renderActions(container) {
    const pending = summary.lotes.find(l => l.estado === 'preparando' || l.estado === 'verificado')
    if (summary.elegibles > 0 && !pending) container.append(button('Descargar evidencias', () => run(), true))
    for (const batch of summary.lotes) {
      const row = document.createElement('div'); row.className = 'evidencias-lote'
      if (batch.vence_at) {
        row.append(message(`ZIP disponible hasta ${new Date(batch.vence_at).toLocaleString('es-MX')}.`))
        row.append(button('Volver a descargar ZIP', () => download(batch.id)))
      }
      if (batch.estado === 'preparando' || batch.estado === 'verificado') {
        row.append(message(batch.estado === 'preparando'
          ? 'Preparando tu archivo ZIP. Puedes volver aquí si se interrumpe.'
          : 'ZIP listo. La eliminación de algunos originales sigue pendiente.'))
        row.append(button(batch.error ? 'Reintentar' : 'Continuar preparación', () => run(batch.id), !batch.vence_at))
      }
      container.append(row)
    }
  }
  function renderPanel() {
    const panel = document.getElementById('evidencias-descargas')
    if (!panel) return
    panel.replaceChildren(); panel.hidden = !summary.elegibles && !summary.lotes.length
    if (panel.hidden) return
    const title = document.createElement('strong'); title.textContent = 'Evidencias de entrega'
    panel.append(title)
    if (summary.elegibles > 0) panel.append(message(AVISO))
    renderActions(panel)
  }
  function renderDialog() {
    if (!dialog) return
    dialog.replaceChildren()
    const title = document.createElement('h2'); title.id = 'evidencias-titulo'; title.textContent = 'Evidencias de entrega'
    const text = message(summary.elegibles > 0 ? AVISO : 'Tu lote de evidencias está disponible aquí y en el historial.')
    text.id = 'evidencias-descripcion'
    const status = message(busy ? 'Preparando la descarga…' : '')
    status.id = 'evidencias-estado'; status.setAttribute('role', 'status')
    dialog.append(title, text, status)
    renderActions(dialog)
    const dismiss = button('Cerrar', close); dismiss.disabled = false; dialog.append(dismiss)
  }
  function show() {
    if (dialog || dismissed || (!summary.elegibles && !summary.lotes.length)) return
    previousFocus = document.activeElement
    dialog = document.createElement('dialog'); dialog.className = 'evidencias-aviso'
    dialog.setAttribute('aria-labelledby', 'evidencias-titulo')
    dialog.setAttribute('aria-describedby', 'evidencias-descripcion')
    dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
    document.body.append(dialog); renderDialog(); dialog.showModal()
  }
  function update(data) {
    summary = { elegibles: data.elegibles || 0, lotes: data.lotes || [] }
    renderPanel(); renderDialog()
  }
  async function check(reopen = false) {
    if (checking || busy) return
    checking = true
    try {
      if (reopen) dismissed = false
      if (!await session()) return
      update(await call({ action: 'status' })); show()
    } catch (error) { console.warn('[evidencias]', error.message) }
    finally { checking = false }
  }
  async function save(id) {
    const blob = await call({ action: 'download', batch_id: id })
    if (!(blob instanceof Blob) || blob.type !== 'application/zip') throw new Error('El ZIP no está disponible. Reintenta desde el historial.')
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = `GUEPAPP-evidencias-${id}.zip`
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  function failure(error) {
    const el = document.getElementById('evidencias-estado')
    if (el) el.textContent = error.message
    else options.onError?.(error.message)
  }
  async function download(id) {
    if (busy) return
    busy = true; renderPanel(); renderDialog()
    let error
    try { await save(id) } catch (e) { error = e }
    finally { busy = false; renderPanel(); renderDialog(); if (error) failure(error) }
  }
  async function run(id) {
    if (busy) return
    busy = true; renderPanel(); renderDialog()
    const version = epoch; let error
    try {
      requestKey ||= crypto.randomUUID()
      const data = await call(id ? { action: 'retry', batch_id: id } : { action: 'start', key: requestKey })
      update(data)
      const batch = summary.lotes.find(l => l.id === (id || data.id))
      if (batch?.vence_at) {
        requestKey = null
        try { await save(batch.id) }
        finally { await options.onChange?.() }
      } else if (batch && !batch.error) {
        clearTimeout(timer)
        timer = setTimeout(() => { if (version === epoch) run(batch.id) }, 4000)
      } else if (batch?.error) {
        throw new Error('La preparación no terminó. Pulsa Reintentar; se conservaron los archivos pendientes.')
      } else if (!batch) requestKey = null
    } catch (e) { error = e }
    finally { busy = false; renderPanel(); renderDialog(); if (error) failure(error) }
  }
  function iniciar(config) {
    options = config
    if (!started) {
      started = true
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) hidden = true
        else if (hidden) { hidden = false; check(true) }
      })
      window.addEventListener('pageshow', event => { if (event.persisted) check(true) })
      window.addEventListener('online', () => check())
      options.db.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') clear()
        else if (event === 'SIGNED_IN') setTimeout(() => check(), 0)
      })
    }
    check()
  }
  return { iniciar }
})()
