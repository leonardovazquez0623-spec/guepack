// supabase/functions/mercadopago-webhook/index.ts
// Recibe notificaciones de pago de Mercado Pago.
//
// Seguridad: verificación de firma oficial x-signature (HMAC-SHA256).
// El secreto se configura en el panel de desarrollador de MP:
//   Tus integraciones → selecciona la app → Webhooks → [Editar webhook] → "Secreto"
// Guárdalo en Supabase como MERCADOPAGO_WEBHOOK_SECRET.
//
// Formatos soportados:
//   Webhooks 2.0: { type:"payment", data:{ id:"123" }, action:"payment.created" }
//   action-only:  { action:"payment.updated", data:{ id:"123" } }
//   IPN legacy:   { topic:"payment", resource:"https://.../v1/payments/123" }
//
// Siempre devuelve 200 para que MP no reintente en loop.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Verifica la firma x-signature enviada por Mercado Pago.
// Referencia oficial: https://www.mercadopago.com.mx/developers/es/docs/your-integrations/notifications/webhooks#bookmark_validacion_de_firma
async function verificarFirmaMP(req: Request, dataId: string | null): Promise<boolean> {
  const secret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) {
    console.error("MERCADOPAGO_WEBHOOK_SECRET no configurado — rechazando");
    return false;
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");

  if (!xSignature) {
    console.error("Webhook MP sin x-signature");
    return false;
  }

  // x-signature tiene formato: ts=<timestamp>,v1=<hmac>
  const parts = Object.fromEntries(
    xSignature.split(",").map(part => {
      const [k, ...v] = part.split("=");
      return [k.trim(), v.join("=").trim()];
    })
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];

  if (!ts || !v1) {
    console.error("x-signature mal formado:", xSignature);
    return false;
  }

  // Construye el mensaje a firmar según la spec de MP
  let mensaje = "";
  if (dataId) mensaje += `id:${dataId};`;
  if (xRequestId) mensaje += `request-id:${xRequestId};`;
  mensaje += `ts:${ts};`;

  // HMAC-SHA256
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", keyMaterial, encoder.encode(mensaje));
  const hmacHex = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  if (hmacHex !== v1) {
    console.error("Firma MP inválida. Esperado:", hmacHex, "| Recibido:", v1, "| Mensaje:", mensaje);
    return false;
  }

  return true;
}

serve(async (req) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return new Response("ok", { status: 200 });

    console.log("MP WEBHOOK body:", JSON.stringify(body));

    // Extrae el payment_id según el formato recibido
    let paymentId: string | null = null;

    const isPaymentEvent =
      body.type === "payment" ||
      body.action === "payment.created" ||
      body.action === "payment.updated";

    if (isPaymentEvent && body.data?.id) {
      paymentId = String(body.data.id);
    } else if (body.topic === "payment" && body.resource) {
      const match = String(body.resource).match(/\/payments\/(\d+)/);
      if (match) paymentId = match[1];
    }

    // Verifica firma HMAC usando el data.id extraído (o null para IPN legacy)
    const firmaValida = await verificarFirmaMP(req, isPaymentEvent ? (body.data?.id ? String(body.data.id) : null) : null);
    if (!firmaValida) {
      console.error("Webhook MP rechazado por firma inválida");
      return new Response("Unauthorized", { status: 401 });
    }

    if (!paymentId) {
      console.log("Evento sin payment_id, ignorado. type:", body.type, "action:", body.action);
      return new Response("ok", { status: 200 });
    }

    const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")!;
    if (!mpToken) {
      console.error("MERCADOPAGO_ACCESS_TOKEN no configurado");
      return new Response("ok", { status: 200 });
    }

    // Consulta el pago completo a MP para verificar el status real
    const pagoRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpToken}` },
    });

    if (!pagoRes.ok) {
      console.error("Error consultando pago MP", paymentId, ":", await pagoRes.text());
      return new Response("ok", { status: 200 });
    }

    const pago = await pagoRes.json();
    console.log("Pago MP — id:", pago.id, "| status:", pago.status, "| external_reference:", pago.external_reference);

    if (pago.status !== "approved") {
      // Pendiente, rechazado, etc. — MP notificará de nuevo cuando cambie
      return new Response("ok", { status: 200 });
    }

    const ref = pago.external_reference;
    if (!ref) {
      console.error("Pago aprobado sin external_reference, payment_id:", paymentId);
      return new Response("ok", { status: 200 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Determina si es pago de pedido local ("pedido_123") o envío nacional ("45")
    const esPedido = ref.startsWith("pedido_");
    const rawId    = esPedido ? ref.slice("pedido_".length) : ref;

    console.log("external_reference:", ref, "| esPedido:", esPedido, "| id:", rawId);

    if (esPedido) {
      // ── Flujo pedido local ────────────────────────────────────────────────────

      const { data: pedido } = await supabaseAdmin
        .from("pedidos")
        .select("id, pago_verificado")
        .eq("id", rawId)
        .maybeSingle();

      if (!pedido) {
        console.error("Pedido no encontrado para external_reference:", ref);
        return new Response("ok", { status: 200 });
      }
      if (pedido.pago_verificado) {
        console.log("Pago ya verificado previamente, pedido_id:", rawId);
        return new Response("ok", { status: 200 });
      }

      // Marca pagado y cambia estado a Pendiente para entrar al flujo de asignación
      const { error: updateErr } = await supabaseAdmin
        .from("pedidos")
        .update({
          pago_verificado:        true,
          pago_verificado_at:     new Date().toISOString(),
          mercadopago_payment_id: String(paymentId),
          metodo_pago:            "tarjeta",
          estado:                 "Pendiente",
        })
        .eq("id", rawId);

      if (updateErr) {
        console.error("Error actualizando pedido:", updateErr.message);
        return new Response("ok", { status: 200 });
      }

      // Dispara ronda 1 de asignación automática (mismo mecanismo que el frontend)
      try {
        const asigRes = await fetch(
          `${supabaseUrl}/functions/v1/procesar-asignacion`,
          {
            method: "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ pedido_id: Number(rawId), ronda: 1 }),
          }
        );
        const asigJson = await asigRes.json();
        console.log("procesar-asignacion respuesta:", JSON.stringify(asigJson));
      } catch (e: any) {
        console.error("Error llamando procesar-asignacion:", e.message);
      }

      return new Response("ok", { status: 200 });

    } else {
      // ── Flujo envío nacional ─────────────────────────────────────────────────

      const envioId = rawId;

      const { data: envio } = await supabaseAdmin
        .from("envios_nacionales")
        .select("id, pago_verificado")
        .eq("id", envioId)
        .maybeSingle();

      if (!envio) {
        console.error("Envío no encontrado para external_reference:", ref);
        return new Response("ok", { status: 200 });
      }
      if (envio.pago_verificado) {
        console.log("Pago ya verificado previamente, envio_id:", envioId);
        return new Response("ok", { status: 200 });
      }

      const { error: updateErr } = await supabaseAdmin
        .from("envios_nacionales")
        .update({
          pago_verificado:         true,
          pago_verificado_at:      new Date().toISOString(),
          mercadopago_payment_id:  String(paymentId),
        })
        .eq("id", envioId);

      if (updateErr) {
        console.error("Error actualizando pago_verificado:", updateErr.message);
        return new Response("ok", { status: 200 });
      }

      const guiaRes = await fetch(
        `${supabaseUrl}/functions/v1/skydropx-generar-guia`,
        {
          method: "POST",
          headers: {
            "Content-Type":      "application/json",
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
            estado:                "pago_recibido_guia_pendiente",
            error_generacion_guia: errText,
          })
          .eq("id", envioId);
      } else {
        const guiaJson = await guiaRes.json();
        console.log("Guía generada automáticamente:", JSON.stringify(guiaJson));
      }

      return new Response("ok", { status: 200 });
    }

  } catch (e: any) {
    console.error("Error inesperado en webhook MP:", e.message);
    return new Response("ok", { status: 200 });
  }
});
