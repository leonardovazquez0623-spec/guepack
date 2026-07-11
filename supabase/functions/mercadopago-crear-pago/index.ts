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
    const mpToken    = Deno.env.get("MP_ACCESS_TOKEN")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify({
        items: [{
          title:     `Guía GUEPACK GK-N${envio_id}`,
          quantity:  1,
          unit_price: parseFloat(envio.costo_total) || 0,
          currency_id: "MXN",
        }],
        payer: {
          name:  envio.origen_nombre || envio.destino_nombre || "Cliente GUEPACK",
          email: envio.origen_email  || "cliente@guepack.com",
          phone: { number: (envio.origen_telefono || "0000000000").replace(/\D/g, "") },
        },
        back_urls: {
          success: `https://guepack.com/app.html?pago=exitoso&envio_id=${envio_id}`,
          failure: `https://guepack.com/app.html?pago=fallido&envio_id=${envio_id}`,
          pending: `https://guepack.com/app.html?pago=pendiente&envio_id=${envio_id}`,
        },
        auto_return:          "approved",
        external_reference:   String(envio_id),
        notification_url:     `${supabaseUrl}/functions/v1/mercadopago-webhook`,
        statement_descriptor: "GUEPACK",
        metadata:             { envio_id: String(envio_id) },
      }),
    });

    if (!mpRes.ok) {
      const errText = await mpRes.text();
      console.error("Mercado Pago error:", errText);
      return json({ error: "Error al crear el link de pago", detail: errText }, 502);
    }

    const mpJson = await mpRes.json();
    const preferenceId = mpJson.id;
    const checkoutUrl  = mpJson.init_point;   // sandbox: mpJson.sandbox_init_point

    if (!checkoutUrl) {
      console.error("MP no devolvió init_point:", JSON.stringify(mpJson));
      return json({ error: "Mercado Pago no devolvió el link de pago" }, 502);
    }

    // 4. Persiste preference_id y URL en BD
    const { error: updateErr } = await supabaseAdmin
      .from("envios_nacionales")
      .update({ mp_preference_id: preferenceId, checkout_url: checkoutUrl })
      .eq("id", envio_id);

    if (updateErr) console.error("Error guardando preference en BD:", updateErr.message);

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
