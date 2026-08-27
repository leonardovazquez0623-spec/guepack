// supabase/functions/skydropx-consultar-shipment/index.ts
// Consulta de solo lectura de un shipment en Skydropx, para diagnóstico
// y reparación manual de envíos. No modifica nada en la base de datos.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSkydropxToken, skydropxHost } from "../_shared/skydropx-auth.ts";
import { origenPermitidoOFallback } from "../_shared/cors.ts";

const corsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin") ?? ""
  return {
    "Access-Control-Allow-Origin": origenPermitidoOFallback(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  }
}

serve(async (req) => {
  const hdrs = corsHeaders(req)

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...hdrs, "Content-Type": "application/json" },
    })
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: hdrs });

  try {
    const internalSecret = Deno.env.get("INTERNAL_FUNCTIONS_SECRET");
    const isInternal = internalSecret &&
      req.headers.get("x-internal-secret") === internalSecret;

    if (!isInternal) {
      return json({ error: "No autorizado" }, 401);
    }

    const { shipment_id } = await req.json();
    if (!shipment_id) return json({ error: "Falta shipment_id" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const host = skydropxHost();

    let token: string;
    let res: Response;
    try {
      token = await getSkydropxToken(supabaseAdmin);
      res = await fetch(`${host}/api/v1/shipments/${encodeURIComponent(shipment_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e: any) {
      return json({
        ok: false,
        error: "No fue posible comunicarse con Skydropx",
        detail: e.message,
      }, 502);
    }

    if (!res.ok) {
      const errText = await res.text();
      return json({
        ok: false,
        error: "Skydropx rechazó la consulta del envío",
        detail: errText,
      }, res.status);
    }

    let shipment: any;
    try {
      shipment = await res.json();
    } catch (e: any) {
      return json({
        ok: false,
        error: "Skydropx respondió sin datos válidos",
        detail: e.message,
      }, 502);
    }

    const paquete = (shipment.included ?? []).find(
      (item: any) => item.type === "package"
    );

    return json({
      ok: true,
      tracking_number: paquete?.attributes?.tracking_number ?? null,
      label_url: paquete?.attributes?.label_url ?? null,
      tracking_url_provider: paquete?.attributes?.tracking_url_provider ?? null,
      tracking_status: paquete?.attributes?.tracking_status ?? null,
      raw_included: shipment.included,
    });
  } catch (e: any) {
    return json({ ok: false, error: e.message }, 500);
  }
});
