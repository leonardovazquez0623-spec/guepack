// supabase/functions/mercadopago-crear-pago-pedido/index.ts
// Crea una preferencia de pago en Mercado Pago para un pedido local.
// Solo aplica a clientes generales (sin empresa_codigo).
// Interfaz: recibe { pedido_id } y devuelve { checkout_url }.

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
      return jsonRes(hdrs, { error: "Cuerpo de solicitud inválido" }, 400);
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

    // 4. Bloquea cuentas empresariales
    if (pedido.empresa_codigo) {
      return jsonRes(hdrs, { error: "Este método de pago no aplica para cuentas empresariales" }, 403);
    }

    // 5. Solo procesa pedidos en estado de pago pendiente
    if (pedido.estado !== "Pendiente pago MP") {
      return jsonRes(hdrs, { error: "Este pedido ya fue procesado o no requiere pago por este medio" }, 400);
    }

    // 6. Crea la preferencia en Mercado Pago
    const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpToken) return jsonRes(hdrs, { error: "MERCADOPAGO_ACCESS_TOKEN no configurado" }, 500);

    console.log("Token existe:", !!mpToken, "longitud:", mpToken?.length);
    console.log("Primeros 8 caracteres:", mpToken?.slice(0, 8));

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify({
        items: [{
          title:       `Pedido GUEPACK ${pedido_id}`,
          quantity:    1,
          currency_id: "MXN",
          unit_price:  parseFloat(pedido.precio) || 0,
        }],
        payer: {
          name:  pedido.nombre || "Cliente GUEPACK",
          phone: pedido.whatsapp ? { number: pedido.whatsapp } : undefined,
        },
        payment_methods: {
          excluded_payment_types: [{ id: "bank_transfer" }],
        },
        external_reference: `pedido_${pedido_id}`,
        back_urls: {
          success: `https://guepack.com/app.html?pago=exitoso&pedido_id=${pedido_id}`,
          failure: `https://guepack.com/app.html?pago=fallido&pedido_id=${pedido_id}`,
          pending: `https://guepack.com/app.html?pago=pendiente&pedido_id=${pedido_id}`,
        },
        auto_return:      "approved",
        notification_url: "https://zkrnjdsnuyjaxxnluzmn.supabase.co/functions/v1/mercadopago-webhook",
      }),
    });

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error("Mercado Pago error:", errText);
      return jsonRes(hdrs, { error: "Error al crear el link de pago", detail: errText }, 502);
    }

    const mpJson = await mpRes.json();
    const preferenceId = mpJson.id;

    const isSandbox   = mpToken.startsWith("TEST-");
    const checkoutUrl = isSandbox ? mpJson.sandbox_init_point : mpJson.init_point;

    if (!checkoutUrl) {
      console.error("MP no devolvió URL de checkout:", JSON.stringify(mpJson));
      return jsonRes(hdrs, { error: "Mercado Pago no devolvió el link de pago" }, 502);
    }

    // 7. Persiste preference_id y checkout_url en el pedido
    const { error: updateErr } = await supabaseAdmin
      .from("pedidos")
      .update({ mercadopago_preference_id: preferenceId, checkout_url: checkoutUrl })
      .eq("id", pedido_id);

    if (updateErr) console.error("Error guardando preference en BD:", updateErr.message);

    return jsonRes(hdrs, { checkout_url: checkoutUrl });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Error no controlado en mercadopago-crear-pago-pedido:", msg);
    return jsonRes(hdrs, { error: msg }, 500);
  }
});
