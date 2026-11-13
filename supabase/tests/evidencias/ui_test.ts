import { Window } from "happy-dom";

const code = await Deno.readTextFile(
  new URL("../../../evidencias-entrega.js", import.meta.url),
);
const AVISO =
  "Tienes evidencias de entregas de hace 30 días o más. Al descargarlas, se eliminarán de GUEPAPP. Guarda el archivo ZIP para conservarlas.";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
function setup(valid = true, eligible = 1) {
  const window = new Window({ url: "https://guepack.com/app.html" });
  window.document.body.innerHTML =
    '<div id="evidencias-descargas" hidden></div>';
  const calls: string[] = [];
  let authChange: (event: string) => void = () => {};
  let validSession = valid;
  let finishStart: (() => void) | undefined;
  const user = {
    id: "client-a",
    email_confirmed_at: "2026-01-01",
    is_anonymous: false,
  };
  Object.assign(window, {
    tenantConfigReady: Promise.resolve(),
    tenantConfig: { id: 1 },
    testOptions: {
      db: {
        auth: {
          getUser: () =>
            Promise.resolve({
              data: { user: validSession ? user : null },
              error: null,
            }),
          onAuthStateChange: (cb: (event: string) => void) => {
            authChange = cb;
          },
        },
        functions: {
          invoke: (_name: string, { body }: { body: { action: string } }) => {
            calls.push(body.action);
            if (body.action === "start") {
              return new Promise((resolve) => {
                finishStart = () =>
                  resolve({ data: { elegibles: 0, lotes: [] }, error: null });
              });
            }
            return Promise.resolve({
              data: { elegibles: eligible, lotes: [] },
              error: null,
            });
          },
        },
      },
    },
  });
  window.eval(code + "\nGuepEvidencias.iniciar(testOptions);");
  return {
    window,
    calls,
    signOut: () => {
      validSession = false;
      authChange("SIGNED_OUT");
    },
    finish: () => finishStart?.(),
  };
}

Deno.test("UI: sin sesión validada y sin evidencias no se envía aviso ni se crea lote", async () => {
  for (const [valid, eligible] of [[false, 1], [true, 0]] as const) {
    const h = setup(valid, eligible);
    try {
      await tick();
      assert(!h.window.document.querySelector("dialog"));
      assert(h.calls.length === (valid ? 1 : 0));
      assert(!h.calls.includes("start"));
    } finally {
      await h.window.happyDOM.close();
    }
  }
});

Deno.test("UI: aviso literal, cerrar conserva, vuelve al reabrir y recargar", async () => {
  const h = setup();
  try {
    await tick();
    const dialog = h.window.document.querySelector("dialog");
    assert(dialog);
    assert(dialog.textContent.includes(AVISO));
    assert(
      [...dialog.querySelectorAll("button")].some((b) =>
        b.textContent === "Descargar evidencias"
      ),
    );
    [...dialog.querySelectorAll("button")].find((b) =>
      b.textContent === "Cerrar"
    )!.click();
    assert(!h.window.document.querySelector("dialog"));
    assert(!h.calls.includes("start"));
    const reopen = new h.window.Event("pageshow");
    Object.defineProperty(reopen, "persisted", { value: true });
    h.window.dispatchEvent(reopen);
    await tick();
    assert(h.window.document.querySelector("dialog"));
  } finally {
    await h.window.happyDOM.close();
  }
  const reload = setup();
  try {
    await tick();
    assert(reload.window.document.querySelector("dialog"));
  } finally {
    await reload.window.happyDOM.close();
  }
});

Deno.test("UI: clic duplicado produce una solicitud; cerrar sesión elimina aviso y descargas", async () => {
  const h = setup();
  try {
    await tick();
    const btn = h.window.document.querySelector(
      "dialog .btn-primary",
    ) as unknown as { click: () => void };
    assert(btn);
    btn.click();
    btn.click();
    await tick();
    assert(h.calls.filter((c) => c === "start").length === 1);
    h.signOut();
    assert(!h.window.document.querySelector("dialog"));
    assert(
      h.window.document.getElementById("evidencias-descargas")!.hasAttribute(
        "hidden",
      ),
    );
    h.finish();
    await tick();
    assert(!h.window.document.querySelector("dialog"));
  } finally {
    await h.window.happyDOM.close();
  }
});
