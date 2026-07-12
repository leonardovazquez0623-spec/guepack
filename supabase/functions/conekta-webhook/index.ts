// supabase/functions/conekta-webhook/index.ts
// Recibe eventos de Conekta. Sin JWT — autenticación temporal por IP.
// TODO: cuando Conekta apruebe la cuenta y /webhook_keys esté disponible,
// reemplazar validación por firma RSA (más robusta).

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// IPs de los servidores de notificación de Conekta.
// Actualizar desde: https://developers.conekta.com/reference/webhooks
const IPS_CONEKTA = ["52.200.151.182", "52.72.53.105", "186.28.176.85"];

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    ""
  )
}

serve(async (req) => {
  const ip = getClientIp(req);
  if (!IPS_CONEKTA.includes(ip)) {
    console.error("Webhook rechazado, IP no reconocida:", ip);
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    console.log("CONEKTA WEBHOOK EVENT:", JSON.stringify(body));

    const eventType = body.type;

    if (eventType === "order.paid" || eventType === "charge.paid") {
      const obj = body.data?.object;

      // order.paid: metadata está en el objeto de la orden directamente
      // charge.paid: metadata está en la orden anidada dentro del cargo
      const envioId =
        obj?.metadata?.envio_id ??
        obj?.order?.metadata?.envio_id;

      if (!envioId) {
        console.error("No se encontró envio_id en metadata del evento:", JSON.stringify(obj?.metadata));
        return new Response("ok", { status: 200 });
      }

      // Marca pago verificado
      const { error: updateErr } = await supabaseAdmin
        .from("envios_nacionales")
        .update({
          pago_verificado: true,
          pago_verificado_at: new Date().toISOString(),
        })
        .eq("id", envioId);

      if (updateErr) {
        console.error("Error actualizando pago_verificado:", updateErr.message);
        return new Response("ok", { status: 200 });
      }

      // Dispara generación de guía automáticamente
      const guiaRes = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/skydropx-generar-guia`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": Deno.env.get("INTERNAL_FUNCTIONS_SECRET") ?? "",
          },
          body: JSON.stringify({ envio_id: envioId }),
        }
      );

      if (!guiaRes.ok) {
        const errText = await guiaRes.text();
        console.error("Error generando guía automática para envio_id", envioId, ":", errText);
        await supabaseAdmin
          .from("envios_nacionales")
          .update({
            estado: "pago_recibido_guia_pendiente",
            error_generacion_guia: errText,
          })
          .eq("id", envioId);
      } else {
        const guiaJson = await guiaRes.json();
        console.log("Guía generada automáticamente:", JSON.stringify(guiaJson));
      }
    }

    // Siempre 200 — Conekta reintenta si no recibe 2xx
    return new Response("ok", { status: 200 });

  } catch (e: any) {
    console.error("Error inesperado en webhook:", e.message);
    return new Response("ok", { status: 200 });
  }
});
