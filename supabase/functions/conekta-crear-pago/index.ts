// supabase/functions/conekta-crear-pago/index.ts
// Crea un PaymentLink en Conekta para que el cliente pague su envío nacional.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://guepack.com",
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
      .select("id, user_id, estado, paqueteria, costo_total, destino_nombre, origen_email, origen_telefono")
      .eq("id", envio_id)
      .single();

    if (fetchErr || !envio) return json({ error: "Envío no encontrado" }, 404);
    if (envio.user_id !== user.id) return json({ error: "No autorizado" }, 403);
    if (envio.estado !== "pendiente_pago") return json({ error: "Este envío ya fue procesado" }, 400);

    // 3. Crea el PaymentLink en Conekta
    const basicAuth = btoa(Deno.env.get("CONEKTA_PRIVATE_KEY")! + ":");
    const expiresAt = Math.floor(Date.now() / 1000) + 86400;

    const conektaRes = await fetch("https://api.conekta.io/checkouts", {
      method: "POST",
      headers: {
        accept: "application/vnd.conekta-v2.2.0+json",
        "content-type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        name: `Guia GUEPACK ${envio_id}`,
        type: "PaymentLink",
        recurrent: false,
        expires_at: expiresAt,
        needs_shipping_contact: false,
        allowed_payment_methods: ["cash", "card"],
        success_url: `https://guepack.com/app.html?pago=exitoso&envio_id=${envio_id}`,
        failure_url: `https://guepack.com/app.html?pago=fallido&envio_id=${envio_id}`,
        order_template: {
          line_items: [{
            name: `Guia nacional ${envio.paqueteria || "envio"}`,
            unit_price: Math.round(envio.costo_total * 100),
            quantity: 1,
          }],
          currency: "MXN",
          customer_info: {
            name: envio.destino_nombre || "Cliente GUEPACK",
            email: envio.origen_email || "cliente@guepack.com",
            phone: envio.origen_telefono || "0000000000",
          },
          metadata: { envio_id: String(envio_id) },
        },
      }),
    });

    if (!conektaRes.ok) {
      const errText = await conektaRes.text();
      console.error("Conekta error:", errText);
      return json({ error: "Error al crear el link de pago", detail: errText }, 502);
    }

    const conektaJson = await conektaRes.json();
    const checkoutId  = conektaJson.id;
    const checkoutUrl = conektaJson.url;

    if (!checkoutUrl) {
      console.error("Conekta no devolvió URL:", JSON.stringify(conektaJson));
      return json({ error: "Conekta no devolvió el link de pago" }, 502);
    }

    // 4. Persiste checkout_id y URL en BD
    const { error: updateErr } = await supabaseAdmin
      .from("envios_nacionales")
      .update({ conekta_checkout_id: checkoutId, checkout_url: checkoutUrl })
      .eq("id", envio_id);

    if (updateErr) console.error("Error guardando checkout en BD:", updateErr.message);

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
