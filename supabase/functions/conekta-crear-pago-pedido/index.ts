// supabase/functions/conekta-crear-pago-pedido/index.ts
// Crea un PaymentLink en Conekta para que el cliente pague un pedido local.
// Solo aplica a clientes generales (sin empresa_codigo).

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://guepack.com", "https://www.guepack.com"];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

function jsonRes(hdrs: Record<string, string>, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...hdrs, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  let hdrs: Record<string, string> = {};
  try {
    hdrs = getCorsHeaders(req);
  } catch (_) {
    hdrs = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    };
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: hdrs });
  }

  try {
    // 1. Valida JWT del cliente
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader ?? "" } } }
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) return jsonRes(hdrs, { error: "No autorizado" }, 401);

    // 2. Parsea el cuerpo
    let body: { pedido_id?: unknown };
    try {
      body = await req.json();
    } catch (_) {
      return jsonRes(hdrs, { error: "Cuerpo de solicitud invalido" }, 400);
    }
    const { pedido_id } = body;
    if (!pedido_id) return jsonRes(hdrs, { error: "Falta pedido_id" }, 400);

    // 3. Carga el pedido con el service role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: pedido, error: fetchErr } = await supabaseAdmin
      .from("pedidos")
      .select("id, user_id, empresa_codigo, precio, nombre, whatsapp, estado")
      .eq("id", pedido_id)
      .single();

    if (fetchErr || !pedido) return jsonRes(hdrs, { error: "Pedido no encontrado" }, 404);
    if (pedido.user_id !== user.id) return jsonRes(hdrs, { error: "No autorizado" }, 403);
    if (pedido.empresa_codigo) {
      return jsonRes(hdrs, { error: "Este metodo de pago no aplica para cuentas empresariales" }, 403);
    }
    if (pedido.estado !== "Pendiente pago MP") {
      return jsonRes(hdrs, { error: "Este pedido ya fue procesado o no requiere pago por este medio" }, 400);
    }

    // 4. Crea el PaymentLink en Conekta
    const conektaKey = Deno.env.get("CONEKTA_PRIVATE_KEY");
    if (!conektaKey) return jsonRes(hdrs, { error: "CONEKTA_PRIVATE_KEY no configurado" }, 500);

    const basicAuth  = btoa(conektaKey + ":");
    const expiresAt  = Math.floor(Date.now() / 1000) + 86400;

    const conektaRes = await fetch("https://api.conekta.io/checkouts", {
      method: "POST",
      headers: {
        accept:           "application/vnd.conekta-v2.2.0+json",
        "content-type":   "application/json",
        Authorization:    `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        name:                    `Pedido GUEPACK ${pedido_id}`,
        type:                    "PaymentLink",
        recurrent:               false,
        expires_at:              expiresAt,
        needs_shipping_contact:  false,
        allowed_payment_methods: ["cash", "card"],
        success_url: `https://guepack.com/app.html?pago=exitoso&pedido_id=${pedido_id}`,
        failure_url: `https://guepack.com/app.html?pago=fallido&pedido_id=${pedido_id}`,
        order_template: {
          line_items: [{
            name:       `Pedido GUEPACK ${pedido_id}`,
            unit_price: Math.round(Number(pedido.precio) * 100),
            quantity:   1,
          }],
          currency: "MXN",
          customer_info: {
            name:  pedido.nombre  || "Cliente GUEPACK",
            email: "cliente@guepack.com",
            phone: pedido.whatsapp || "0000000000",
          },
          metadata: { pedido_id: String(pedido_id) },
        },
      }),
    });

    if (!conektaRes.ok) {
      const errText = await conektaRes.text();
      console.error("Conekta error:", errText);
      return jsonRes(hdrs, { error: "Error al crear el link de pago", detail: errText }, 502);
    }

    const conektaJson = await conektaRes.json();
    const checkoutId  = conektaJson.id;
    const checkoutUrl = conektaJson.url;

    if (!checkoutUrl) {
      console.error("Conekta no devolvio URL:", JSON.stringify(conektaJson));
      return jsonRes(hdrs, { error: "Conekta no devolvio el link de pago" }, 502);
    }

    // 5. Persiste checkout_id y URL en el pedido
    const { error: updateErr } = await supabaseAdmin
      .from("pedidos")
      .update({ conekta_checkout_id: checkoutId, checkout_url: checkoutUrl })
      .eq("id", pedido_id);

    if (updateErr) console.error("Error guardando checkout en BD:", updateErr.message);

    return jsonRes(hdrs, { checkout_url: checkoutUrl });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Error no controlado en conekta-crear-pago-pedido:", msg);
    return jsonRes(hdrs, { error: msg }, 500);
  }
});
