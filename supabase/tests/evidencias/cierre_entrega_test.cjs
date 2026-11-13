// Funciones reales del navegador con Supabase/DOM simulados, sin red.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('repartidor.html', 'utf8');
const code = source.slice(source.indexOf('async function cambiarEstado('), source.indexOf('function abrirModalEntrega('))
  + source.slice(source.indexOf('const entregasEnProceso'), source.indexOf('async function abrirFotoEntregaParada('));
function fixture(failure) {
  const state = { failure, estado: 'En camino a entrega', count: 0, calls: 0, uploads: new Map(), notices: [], removed: false };
  const button = { textContent: 'Confirmar entrega', disabled: false };
  let refs;
  function fail(at) {
    if (state.failure === at + '-throw') throw new Error(at);
    return state.failure === at ? { message: at } : null;
  }
  const context = vm.createContext({
    console: { error() {} },
    document: { getElementById: id => ({
      'entrega-foto': { files: failure === 'no-photo' ? [] : [{}] },
      'entrega-canvas': { toBlob(cb) { if (fail('canvas')) throw new Error('canvas'); cb(state.failure === 'null-blob' ? null : {}); } },
      'btn-confirmar-entrega': button,
      'modal-entrega': { remove() { state.removed = true; } },
    }[id]) },
    _pedidosRep: { 1: {} }, _toastRepa: text => state.notices.push(text),
    detenerTracking() {}, _enviarPushTipadoRepartidor() {}, cargarPedidos() {},
    db: {
      auth: { getSession: async () => ({ data: { session: { user: { email: 'test' } } } }) },
      storage: { from: bucket => ({ upload: async (path, file, options) => {
        assert.equal(bucket, 'evidencias'); assert.equal(options.upsert, true);
        const error = fail(path.endsWith('.jpg') ? 'photo' : 'signature');
        if (error) return { error };
        state.uploads.set(path, file); return { data: { path } };
      } }) },
      from: () => ({ update: value => { refs = value; return { eq: () => ({ select: () => ({ single: async () => {
        const error = fail('references');
        return { error, data: error || state.failure === 'no-row' ? null : { id: 1, ...refs } };
      } }) }) }; } }),
      rpc: async name => {
        assert.equal(name, 'marcar_entregado'); state.calls++;
        const error = fail('rpc'); if (error) return { error };
        if (state.estado !== 'Entregado') { state.estado = 'Entregado'; state.count++; }
        return { data: { ok: true } };
      },
    },
  });
  vm.runInContext(code, context);
  return { state, button, run: () => context.confirmarEntrega(1) };
}
(async () => {
  let passed = 0;
  for (const failure of ['photo', 'photo-throw', 'signature', 'signature-throw', 'references', 'references-throw', 'no-row', 'null-blob', 'canvas-throw', 'rpc', 'rpc-throw']) {
    const f = fixture(failure); await f.run();
    assert.equal(f.state.estado, 'En camino a entrega', failure);
    assert.equal(f.state.count, 0); assert.equal(f.state.removed, false);
    assert.equal(f.button.disabled, false); assert.ok(f.state.notices.length);
    f.state.failure = null; await f.run();
    assert.equal(f.state.estado, 'Entregado'); assert.equal(f.state.count, 1);
    assert.equal(f.state.uploads.size, 2); assert.equal(f.state.removed, true);
    passed++;
  }
  const noPhoto = fixture('no-photo'); await noPhoto.run();
  assert.equal(noPhoto.state.calls, 0); assert.equal(noPhoto.state.uploads.size, 0); passed++;
  const duplicate = fixture(); await Promise.all([duplicate.run(), duplicate.run()]);
  assert.equal(duplicate.state.calls, 1); assert.equal(duplicate.state.uploads.size, 2); passed++;
  let adminPassed = 0;
  for (const file of ['admin.html', 'app.html']) {
    const source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf('async function updateStatus(');
    const fn = source.slice(start, source.indexOf('\n}', start) + 2);
    for (const failure of [null, 'returned', 'thrown', 'empty']) {
      const calls = [], alerts = []; let refreshes = 0;
      const context = vm.createContext({
        alert: text => alerts.push(text), cargarPedidos: () => refreshes++,
        db: {
          rpc: async (name, args) => {
            calls.push({ name, args });
            if (failure === 'thrown') throw new Error('fallo');
            return failure === 'returned' ? { error: { message: 'fallo' } }
              : failure === 'empty' ? { data: null } : { data: { ok: true } };
          },
          from: () => { throw new Error('No debe hacer UPDATE directo'); },
        },
      });
      vm.runInContext(fn, context); await context.updateStatus(12, 'Entregado');
      assert.equal(calls[0].name, 'marcar_entregado'); assert.equal(calls[0].args.p_pedido_id,12);
      assert.equal(refreshes,failure ? 0 : 1); assert.equal(alerts.length,failure ? 1 : 0);
      adminPassed++;
    }
    const updates = [];
    const context = vm.createContext({
      alert() { throw new Error('Error inesperado'); }, cargarPedidos() {},
      db: { from: () => ({ update: value => { updates.push(value); return { eq: async () => ({error:null}) }; } }) },
    });
    vm.runInContext(fn,context); await context.updateStatus(12,'Pago rechazado');
    assert.equal(updates[0].estado,'Pago rechazado'); adminPassed++;
  }
  for (const file of ['repartidor.html', 'admin.html', 'app.html']) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new vm.Script(match[1], { filename: file });
    }
  }
  console.log(`${passed} casos A1 aprobados (simulaciones); sintaxis de 3 pantallas correcta`);
  console.log(`${adminPassed} casos A2 aprobados (simulaciones de ambas pantallas)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
