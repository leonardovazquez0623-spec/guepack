// supabase/functions/postalia-colonias/index.ts
// Devuelve la lista completa de colonias para un CP mexicano.
// Función pública (--no-verify-jwt): solo expone un catálogo de CPs.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const ALLOWED_ORIGINS = ["https://guepack.com", "https://www.guepack.com"];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

serve(async (req) => {
  const hdrs = corsHeaders(req);

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...hdrs, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: hdrs });

  try {
    let cp: string;
    try {
      const body = await req.json();
      cp = String(body.cp ?? "").trim();
    } catch {
      return json({ error: "Body inválido" }, 400);
    }

    if (!/^\d{5}$/.test(cp)) {
      return json({ error: "El CP debe tener exactamente 5 dígitos numéricos" }, 400);
    }

    const res = await fetch(
      `https://postalia.com.mx/api/codigos-postales/${cp}`,
      { headers: { Authorization: `Bearer ${Deno.env.get("POSTALIA_TOKEN")}` } }
    );

    if (res.status === 401) {
      console.error("Postalia: token faltante o inválido");
      return json({ error: "Hubo un problema al validar el código postal. Intenta de nuevo en unos minutos." }, 503);
    }
    if (res.status === 404) {
      return json({ error: `El código postal ${cp} no existe. Verifica que esté bien escrito.` }, 404);
    }
    if (res.status === 429) {
      console.error("Postalia: límite diario de consultas superado");
      return json({ error: "Estamos recibiendo muchas solicitudes en este momento. Intenta de nuevo más tarde." }, 429);
    }
    if (!res.ok) {
      return json({ error: `No se pudo validar el código postal ${cp}.` }, 502);
    }

    const data = await res.json();
    return json({
      estado:    data.estado,
      municipio: data.municipio,
      colonias:  (data.colonias ?? []).map((c: any) => c.nombre),
    });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
