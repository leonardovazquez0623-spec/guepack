// Reproduce defectos preexistentes con funciones reales y dependencias simuladas.
// Sólo lee el repositorio; no inicia navegadores ni llama a Supabase.
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
function extract(file, start, end) {
  const text = fs.readFileSync(file, "utf8");
  return text.slice(
    text.indexOf(start),
    text.indexOf(end, text.indexOf(start)),
  );
}
(async () => {
  const transitions = [];
  const document = {
    getElementById: (id) =>
      id === "entrega-foto"
        ? { files: [{ size: 1, type: "image/jpeg" }] }
        : id === "entrega-canvas"
        ? { toBlob: (callback) => callback({ size: 1 }) }
        : id === "modal-entrega"
        ? { remove() {} }
        : {},
  };
  await vm.runInNewContext(
    extract(
      "repartidor.html",
      "async function confirmarEntrega(",
      "async function abrirFotoEntregaParada(",
    ) + ";confirmarEntrega(1)",
    {
      document,
      console: { log() {}, warn() {}, error() {} },
      _pedidosRep: { 1: {} },
      db: {
        storage: {
          from: () => ({
            upload: async () => ({ error: { message: "fallo de prueba" } }),
          }),
        },
      },
      cambiarEstado: async (id, state) => transitions.push({ id, state }),
    },
  );
  assert.equal(transitions[0].state, "Entregado");
  console.log(
    "CONFIRMADO A1: ambas subidas fallan y confirmarEntrega todavía solicita Entregado",
  );

  const updates = [];
  await vm.runInNewContext(
    extract(
      "admin.html",
      "async function updateStatus(",
      "function escaparHTML(",
    ) + ";updateStatus(1,'Entregado')",
    {
      db: {
        from: () => ({
          update: (value) => {
            updates.push(value);
            return { eq: async () => ({ error: null }) };
          },
        }),
      },
      cargarPedidos() {},
    },
  );
  assert.equal(
    JSON.stringify(updates),
    JSON.stringify([{ estado: "Entregado" }]),
  );
  console.log(
    "CONFIRMADO A2: admin sólo actualiza estado; no fecha de entrega ni RPC de contabilización",
  );

  let fetchHandler, response;
  vm.runInNewContext(fs.readFileSync("sw.js", "utf8"), {
    importScripts() {},
    firebase: {
      initializeApp() {},
      messaging: () => ({ onBackgroundMessage() {} }),
    },
    self: {
      addEventListener: (name, fn) => {
        if (name === "fetch") fetchHandler = fn;
      },
    },
    caches: { match: async () => undefined },
    fetch: async () => {
      throw new Error("offline");
    },
    URL,
    console,
  });
  fetchHandler({
    request: { method: "GET", url: "https://guepack.com/app.html" },
    respondWith: (value) => {
      response = value;
    },
  });
  assert.equal(await response, undefined);
  console.log(
    "CONFIRMADO A3: fetch offline sin caché produce undefined en respondWith, no un Response",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
