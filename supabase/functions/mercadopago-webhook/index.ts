// supabase/functions/mercadopago-webhook/index.ts
// Recibe notificaciones de pago de Mercado Pago.
//
// Seguridad: "pull verification" — extraemos el payment_id del evento y lo
// consultamos directamente a la API de MP con nuestro token. Si alguien envía
// un webhook falso, la consulta a MP devolverá datos que no coincidirán.
//
// Soporta dos formatos de notificación:
//   Webhooks 2.0: { type:"payment", data:{ id:"123" }, action:"payment.created" }
//   IPN legacy:   { topic:"payment", resource:"https://.../v1/payments/123" }
//
// Siempre devuelve 200 para que MP no reintente en loop.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return new Response("ok", { status: 200 });

    console.log("MP WEBHOOK:", JSON.stringify(body));

    // Extrae el payment_id según el formato
    let paymentId: string | null = null;

    if (body.type === "payment" && body.data?.id) {
      // Webhooks 2.0
      paymentId = String(body.data.id);
    } else if (body.topic === "payment" && body.resource) {
      // IPN legacy
      const match = String(body.resource).match(/\/payments\/(\d+)/);
      if (match) paymentId = match[1];
    }

    if (!paymentId) {
      console.log("Evento sin payment_id, ignorado. type/topic:", body.type ?? body.topic);
      return new Response("ok", { status: 200 });
    }

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN")!;
    if (!mpToken) {
      console.error("MP_ACCESS_TOKEN no configurado");
      return new Response("ok", { status: 200 });
    }

    // Consulta el pago a MP para verificar el status real
    const pagoRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });

    if (!pagoRes.ok) {
      console.error("Error consultando pago MP", paymentId, ":", await pagoRes.text());
      return new Response("ok", { status: 200 });
    }

    const pago = await pagoRes.json();
    console.log("Pago MP — id:", pago.id, "| status:", pago.status, "| external_ref:", pago.external_reference);

    if (pago.status !== "approved") {
      // Pendiente, rechazado, etc. — MP notificará de nuevo cuando cambie
      return new Response("ok", { status: 200 });
    }

    const envioId = pago.external_reference ?? pago.metadata?.envio_id;
    if (!envioId) {
      console.error("Pago aprobado sin external_reference, payment_id:", paymentId);
      return new Response("ok", { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Idempotencia: no procesar dos veces el mismo pago
    const { data: envio } = await supabaseAdmin
      .from("envios_nacionales")
      .select("id, pago_verificado, numero_guia")
      .eq("id", envioId)
      .maybeSingle();

    if (!envio) {
      console.error("Envío no encontrado para external_reference:", envioId);
      return new Response("ok", { status: 200 });
    }
    if (envio.pago_verificado) {
      console.log("Pago ya verificado previamente, envio_id:", envioId);
      return new Response("ok", { status: 200 });
    }

    // Marca pago verificado
    const { error: updateErr } = await supabaseAdmin
      .from("envios_nacionales")
      .update({
        pago_verificado:    true,
        pago_verificado_at: new Date().toISOString(),
        mp_payment_id:      String(paymentId),
      })
      .eq("id", envioId);

    if (updateErr) {
      console.error("Error actualizando pago_verificado:", updateErr.message);
      return new Response("ok", { status: 200 });
    }

    // Dispara generación de guía — mismo flujo que conekta-webhook
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
      console.error("Error generando guía para envio_id", envioId, ":", errText);
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

    return new Response("ok", { status: 200 });

  } catch (e: any) {
    console.error("Error inesperado en webhook MP:", e.message);
    return new Response("ok", { status: 200 });
  }
});
