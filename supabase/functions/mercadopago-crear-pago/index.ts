// supabase/functions/mercadopago-crear-pago/index.ts
// Crea una preferencia de pago en Mercado Pago para que el cliente pague su envío nacional.
// Interfaz idéntica a conekta-crear-pago: recibe { envio_id } y devuelve { checkout_url }.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Valida JWT del cliente
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader ?? "" } } }
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) return json({ error: "No autorizado" }, 401);

    // 2. Valida el envío
    const { envio_id } = await req.json();
    if (!envio_id) return json({ error: "Falta envio_id" }, 400);

    const { data: envio, error: fetchErr } = await supabaseAdmin
      .from("envios_nacionales")
      .select("id, user_id, estado, paqueteria, costo_total, destino_nombre, origen_nombre, origen_email, origen_telefono")
      .eq("id", envio_id)
      .single();

    if (fetchErr || !envio) return json({ error: "Envío no encontrado" }, 404);
    if (envio.user_id !== user.id) return json({ error: "No autorizado" }, 403);
    if (envio.estado !== "pendiente_pago") return json({ error: "Este envío ya fue procesado" }, 400);

    // 3. Crea la preferencia en Mercado Pago
    const mpToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")!;
    if (!mpToken) return json({ error: "MERCADOPAGO_ACCESS_TOKEN no configurado" }, 500);

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify({
        items: [{
          title:      `Guia GUEPACK ${envio_id}`,
          quantity:   1,
          currency_id: "MXN",
          unit_price: parseFloat(envio.costo_total) || 0,
        }],
        payer: {
          name:  envio.destino_nombre || "Cliente GUEPACK",
          email: envio.origen_email   || "cliente@guepack.com",
        },
        payment_methods: {
          excluded_payment_types: [{ id: "bank_transfer" }],
        },
        external_reference: String(envio_id),
        back_urls: {
          success: `https://guepack.com/app.html?pago=exitoso&envio_id=${envio_id}`,
          failure: `https://guepack.com/app.html?pago=fallido&envio_id=${envio_id}`,
          pending: `https://guepack.com/app.html?pago=pendiente&envio_id=${envio_id}`,
        },
        auto_return:      "approved",
        notification_url: "https://zkrnjdsnuyjaxxnluzmn.supabase.co/functions/v1/mercadopago-webhook",
      }),
    });

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error("Mercado Pago error:", errText);
      return json({ error: "Error al crear el link de pago", detail: errText }, 502);
    }

    const mpJson = await mpRes.json();
    const preferenceId = mpJson.id;

    // Usa sandbox_init_point cuando el token es de pruebas
    const isSandbox   = mpToken.startsWith("TEST-");
    const checkoutUrl = isSandbox ? mpJson.sandbox_init_point : mpJson.init_point;

    if (!checkoutUrl) {
      console.error("MP no devolvió URL de checkout:", JSON.stringify(mpJson));
      return json({ error: "Mercado Pago no devolvió el link de pago" }, 502);
    }

    // 4. Persiste preference_id y URL en BD
    const { error: updateErr } = await supabaseAdmin
      .from("envios_nacionales")
      .update({ mercadopago_preference_id: preferenceId, checkout_url: checkoutUrl })
      .eq("id", envio_id);

    if (updateErr) console.error("Error guardando preference en BD:", updateErr.message);

    // 5. Devuelve la URL al frontend
    return json({ checkout_url: checkoutUrl });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
