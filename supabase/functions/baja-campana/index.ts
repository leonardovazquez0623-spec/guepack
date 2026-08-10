import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verificarBajaToken } from "../_shared/token-baja.ts";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function paginaHtml(mensaje: string, ok: boolean): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GUEPACK Express</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1f2937; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
  .card { background: white; border-radius: 12px; padding: 40px; max-width: 420px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  h1 { font-size: 20px; color: #05101f; margin-bottom: 12px; }
  p { color: #374151; font-size: 14px; line-height: 1.6; }
  .icon { font-size: 40px; margin-bottom: 16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${ok ? "✅" : "⚠️"}</div>
    <h1>GUEPACK Express</h1>
    <p>${mensaje}</p>
  </div>
</body>
</html>`;
}

function responderHtml(html: string, estado = 200) {
  return new Response(html, {
    status: estado,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return responderHtml(paginaHtml("Método no permitido.", false), 405);
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
  const claveServicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl || !claveServicio) {
    console.error("[baja-campana] Faltan variables de entorno");
    return responderHtml(
      paginaHtml("No fue posible procesar tu solicitud. Intenta más tarde.", false),
      500,
    );
  }

  if (!UUID_REGEX.test(userId) || !token) {
    return responderHtml(paginaHtml("El enlace no es válido.", false), 400);
  }

  const tokenValido = await verificarBajaToken(userId, token, claveServicio);
  if (!tokenValido) {
    return responderHtml(paginaHtml("El enlace no es válido.", false), 400);
  }

  const supabaseAdmin = createClient(supabaseUrl, claveServicio, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await supabaseAdmin
    .from("usuarios")
    .update({ marketing_opt_out: true })
    .eq("user_id", userId);

  if (error) {
    console.error("[baja-campana] Error actualizando preferencia:", error);
    return responderHtml(
      paginaHtml("No fue posible procesar tu solicitud. Intenta más tarde.", false),
      500,
    );
  }

  return responderHtml(
    paginaHtml(
      "Listo. Ya no recibirás correos promocionales de GUEPACK Express. Seguirás recibiendo notificaciones sobre tus pedidos activos.",
      true,
    ),
  );
});
