// supabase/functions/skydropx-generar-guia/index.ts
// Genera la guía real en Skydropx. Solo debe llamarse DESPUÉS de que
// pago_verificado = true en envios_nacionales (revisión manual, como en pedidos).

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSkydropxToken, skydropxHost } from "../_shared/skydropx-auth.ts";

const CONSIGNMENT_NOTES: Record<string, string> = {
  documentos:  "14111500",
  ropa:        "53101501",
  electronica: "43191504",
  otro:        "44101601",
};

const PACKAGE_TYPE_DEFAULT = "4G"; // Caja de cartón

const allowedOrigins = ["https://guepack.com", "https://www.guepack.com"]

const corsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin") ?? ""
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Auth: llamada interna O admin JWT ────────────────────────────────────
    const internalSecret = Deno.env.get("INTERNAL_FUNCTIONS_SECRET");
    const isInternal = internalSecret &&
      req.headers.get("x-internal-secret") === internalSecret;

    if (!isInternal) {
      const authHeader = req.headers.get("Authorization");
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader ?? "" } } }
      );
      const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
      if (userErr || !user) return json({ error: "No autorizado" }, 401);

      const { data: perfil } = await supabaseAdmin
        .from("usuarios")
        .select("rol")
        .eq("user_id", user.id)
        .single();
      if (perfil?.rol !== "admin") return json({ error: "Acceso restringido a administradores" }, 403);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const { envio_id } = await req.json();
    if (!envio_id) return json({ error: "Falta envio_id" }, 400);

    // 1. Trae el registro y valida estado
    const { data: envio, error: fetchErr } = await supabaseAdmin
      .from("envios_nacionales")
      .select("*")
      .eq("id", envio_id)
      .single();

    if (fetchErr || !envio) return json({ error: "Envío no encontrado" }, 404);

    if (!envio.pago_verificado) {
      return json({ error: "El pago aún no ha sido verificado. No se puede generar la guía." }, 409);
    }
    if (envio.numero_guia) {
      return json({ error: "Este envío ya tiene una guía generada", numero_guia: envio.numero_guia }, 409);
    }
    if (!envio.skydropx_quotation_id || !envio.skydropx_rate_id) {
      return json({ error: "Falta la cotización o la tarifa seleccionada" }, 400);
    }

    const token = await getSkydropxToken(supabaseAdmin);
    const host = skydropxHost();

    // 2. Crea el envío (guía) en Skydropx
    const shipmentPayload = {
      shipment: {
        quotation_id: envio.skydropx_quotation_id,
        rate_id: envio.skydropx_rate_id,
        address_from: {
          name: envio.origen_nombre,
          street1: envio.origen_calle,
          street_number: envio.origen_numero,
          area_level3: envio.origen_colonia,
          area_level2: envio.origen_ciudad,
          area_level1: envio.origen_estado,
          postal_code: envio.origen_cp,
          country_code: "MX",
          phone: envio.origen_telefono,
          email: envio.origen_email,
          reference: envio.origen_referencia,
        },
        address_to: {
          name: envio.destino_nombre,
          street1: envio.destino_calle,
          street_number: envio.destino_numero,
          area_level3: envio.destino_colonia,
          area_level2: envio.destino_ciudad,
          area_level1: envio.destino_estado,
          postal_code: envio.destino_cp,
          country_code: "MX",
          phone: envio.destino_telefono,
          email: envio.destino_email,
          reference: envio.destino_referencia,
        },
        parcel: {
          weight: envio.peso_kg,
          length: envio.largo_cm,
          width: envio.ancho_cm,
          height: envio.alto_cm,
          consignment_note: CONSIGNMENT_NOTES[envio.contenido] ?? CONSIGNMENT_NOTES.otro,
          package_type: PACKAGE_TYPE_DEFAULT,
        },
      },
    };

    const res = await fetch(`${host}/api/v1/shipments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(shipmentPayload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return json({ error: "Skydropx rechazó la creación del envío", detail: errText }, 502);
    }

    const shipment = await res.json();
    const data = shipment.data ?? shipment;

    // 3. Guarda todo en Supabase
    const { error: updateErr } = await supabaseAdmin
      .from("envios_nacionales")
      .update({
        estado: "guia_generada",
        skydropx_shipment_id: data.id,
        numero_guia: data.tracking_number ?? data.attributes?.tracking_number,
        label_url: data.label_url ?? data.attributes?.label_url,
        tracking_url: data.tracking_url ?? data.attributes?.tracking_url,
      })
      .eq("id", envio_id);

    if (updateErr) return json({ error: "Guía creada pero falló guardar en BD", detail: updateErr.message }, 500);

    return json({
      ok: true,
      numero_guia: data.tracking_number,
      label_url: data.label_url,
      tracking_url: data.tracking_url,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});

