// supabase/functions/conekta-webhook/index.ts
// Recibe eventos de Conekta. Autenticación: firma RSA-SHA256 oficial.
// Conekta firma el body crudo con su llave privada; verificamos con
// CONEKTA_WEBHOOK_PUBLIC_KEY (generada en el panel Conekta → Llaves de webhook).

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verificarFirmaConekta(req: Request, bodyBytes: Uint8Array): Promise<boolean> {
  const publicKeyPem = Deno.env.get("CONEKTA_WEBHOOK_PUBLIC_KEY");
  if (!publicKeyPem) {
    console.error("CONEKTA_WEBHOOK_PUBLIC_KEY no configurado — rechazando");
    return false;
  }

  const digest = req.headers.get("digest");
  if (!digest) {
    console.error("Webhook Conekta sin header 'digest'");
    return false;
  }

  try {
    // ── PEM → DER → CryptoKey ────────────────────────────────────────────
    // Un PEM de llave pública RSA contiene DER codificado en base64 entre
    // los headers -----BEGIN/END PUBLIC KEY-----. crypto.subtle.importKey
    // con formato "spki" espera exactamente esos bytes DER sin headers.
    const pemBody = publicKeyPem
      .replace(/-----BEGIN.*?-----/g, "")
      .replace(/-----END.*?-----/g, "")
      .replace(/\s+/g, "");
    const derBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      "spki",   // SubjectPublicKeyInfo: formato estándar DER de llave pública RSA
      derBytes.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Conekta envía la firma base64 en el header 'digest'.
    // Maneja ambas variantes: con prefijo "sha256=" o sin él.
    const b64 = digest.startsWith("sha256=") ? digest.slice(7) : digest;
    const signatureBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signatureBytes,
      bodyBytes   // body crudo sin parsear — cualquier alteración invalida la firma
    );

    if (!isValid) {
      console.error("Firma Conekta inválida — body alterado o webhook falso");
    }
    return isValid;

  } catch (e: any) {
    console.error("Error en verificarFirmaConekta:", e.message);
    return false;
  }
}

serve(async (req) => {
  // Lee el body como bytes crudos ANTES de cualquier parseo.
  // req.arrayBuffer() y req.json() comparten el mismo stream — solo se puede
  // leer una vez, así que lo leemos una vez aquí y luego parseamos manualmente.
  const bodyBytes = new Uint8Array(await req.arrayBuffer());

  const firmaValida = await verificarFirmaConekta(req, bodyBytes);
  if (!firmaValida) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = JSON.parse(new TextDecoder().decode(bodyBytes));
    console.log("CONEKTA WEBHOOK EVENT:", JSON.stringify(body));

    const eventType = body.type;

    if (eventType === "order.paid" || eventType === "charge.paid") {
      const obj = body.data?.object;

      // order.paid: metadata en el objeto de la orden
      // charge.paid: metadata en la orden anidada dentro del cargo
      const metadata = obj?.metadata ?? obj?.order?.metadata ?? {};

      console.log("Conekta metadata:", JSON.stringify(metadata));

      if (metadata.pedido_id) {
        // ── Flujo pedido local ──────────────────────────────────────────────
        const pedidoId = metadata.pedido_id;

        const { error: updateErr } = await supabaseAdmin
          .from("pedidos")
          .update({
            pago_verificado:    true,
            pago_verificado_at: new Date().toISOString(),
            metodo_pago:        "tarjeta",
            estado:             "Pendiente",
          })
          .eq("id", pedidoId);

        if (updateErr) {
          console.error("Error actualizando pedido:", updateErr.message);
          return new Response("ok", { status: 200 });
        }

        // Dispara ronda 1 de asignacion automatica
        try {
          const asigRes = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/procesar-asignacion`,
            {
              method: "POST",
              headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({ pedido_id: Number(pedidoId), ronda: 1 }),
            }
          );
          const asigJson = await asigRes.json();
          console.log("procesar-asignacion respuesta:", JSON.stringify(asigJson));
        } catch (e: any) {
          console.error("Error llamando procesar-asignacion:", e.message);
        }

      } else if (metadata.envio_id) {
        // ── Flujo envio nacional ────────────────────────────────────────────
        const envioId = metadata.envio_id;

        const { error: updateErr } = await supabaseAdmin
          .from("envios_nacionales")
          .update({
            pago_verificado:    true,
            pago_verificado_at: new Date().toISOString(),
          })
          .eq("id", envioId);

        if (updateErr) {
          console.error("Error actualizando pago_verificado:", updateErr.message);
          return new Response("ok", { status: 200 });
        }

        const guiaRes = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/skydropx-generar-guia`,
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
          console.error("Error generando guia para envio_id", envioId, ":", errText);
          await supabaseAdmin
            .from("envios_nacionales")
            .update({
              estado:                "pago_recibido_guia_pendiente",
              error_generacion_guia: errText,
            })
            .eq("id", envioId);
        } else {
          const guiaJson = await guiaRes.json();
          console.log("Guia generada automaticamente:", JSON.stringify(guiaJson));
        }

      } else {
        console.warn("Webhook sin envio_id ni pedido_id en metadata:", JSON.stringify(metadata));
      }
    }

    return new Response("ok", { status: 200 });

  } catch (e: any) {
    console.error("Error inesperado en webhook:", e.message);
    return new Response("ok", { status: 200 });
  }
});
