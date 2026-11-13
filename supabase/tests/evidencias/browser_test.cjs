// Vista aislada con el CSS real de app.html. Ninguna petición sale a la red.
// Requiere playwright-core y un Chrome/Edge local; no usa cuentas Supabase.
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");

(async () => {
  const executablePath = [
    process.env.EVIDENCIAS_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => p && fs.existsSync(p));
  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ["--headless=new"],
  });
  const app = fs.readFileSync("app.html", "utf8");
  const styles = [...app.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
    (m) => m[1],
  ).join("\n");
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "guep-evidencias-browser-"),
  );
  try {
    for (
      const [name, width, height] of [["mobile", 390, 844], [
        "desktop",
        1280,
        800,
      ]]
    ) {
      const page = await browser.newPage({
        viewport: { width, height },
        acceptDownloads: true,
      });
      await page.route("**/*", (route) => route.abort());
      await page.route(
        "https://guepack.com/app.html",
        (route) =>
          route.fulfill({
            contentType: "text/html",
            body:
              `<style>${styles}</style><div id="evidencias-descargas" hidden></div>`,
          }),
      );
      await page.goto("https://guepack.com/app.html");
      await page.addStyleTag({ path: "evidencias-entrega.css" });
      await page.evaluate(() => {
        window.tenantConfigReady = Promise.resolve();
        window.tenantConfig = { id: 1 };
        window.calls = [];
        const batch = {
          id: "11111111-1111-4111-8111-111111111111",
          estado: "listo",
          vence_at: new Date(Date.now() + 86400000).toISOString(),
        };
        window.testOptions = {
          db: {
            auth: {
              getUser: async () => ({
                data: {
                  user: { id: "fixture", email_confirmed_at: "2026-01-01" },
                },
                error: null,
              }),
              onAuthStateChange: () => {},
            },
            functions: {
              invoke: async (_name, { body }) => {
                window.calls.push(body.action);
                if (body.action === "download") {
                  return {
                    data: new Blob(["fixture ZIP download"], {
                      type: "application/zip",
                    }),
                    error: null,
                  };
                }
                if (body.action === "start") {
                  return {
                    data: { id: batch.id, elegibles: 0, lotes: [batch] },
                    error: null,
                  };
                }
                return { data: { elegibles: 1, lotes: [] }, error: null };
              },
            },
          },
        };
      });
      await page.addScriptTag({ path: "evidencias-entrega.js" });
      await page.evaluate(() =>
        window.GuepEvidencias.iniciar(window.testOptions)
      );
      const dialog = page.locator("dialog");
      await dialog.waitFor({ state: "visible" });
      const box = await dialog.boundingBox();
      assert(
        box.x >= 0 && box.y >= 0 && box.x + box.width <= width &&
          box.y + box.height <= height,
      );
      assert(
        Math.abs(box.x + box.width / 2 - width / 2) < 2 &&
          Math.abs(box.y + box.height / 2 - height / 2) < 2,
      );
      assert.equal(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      assert.equal(
        await dialog.locator("#evidencias-descripcion").textContent(),
        "Tienes evidencias de entregas de hace 30 días o más. Al descargarlas, se eliminarán de GUEPAPP. Guarda el archivo ZIP para conservarlas.",
      );
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(() => window.calls.includes("start")),
        false,
      );
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        )
      );
      await dialog.waitFor({ state: "visible" });
      const downloadEvent = page.waitForEvent("download");
      await dialog.getByRole("button", {
        name: "Descargar evidencias",
        exact: true,
      }).click();
      const download = await downloadEvent;
      assert.equal(await download.failure(), null);
      assert(download.suggestedFilename().endsWith(".zip"));
      assert.equal(
        await page.evaluate(() =>
          window.calls.filter((c) => c === "start").length
        ),
        1,
      );
      console.log(
        `PASS ${name} ${width}x${height}: ajuste, aviso, Escape, reapertura y descarga Blob`,
      );
      await page.close();
    }
    console.log(`Capturas locales: ${dir}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
