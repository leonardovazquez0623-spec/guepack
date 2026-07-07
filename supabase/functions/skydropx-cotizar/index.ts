// supabase/functions/skydropx-cotizar/index.ts
// El frontend NUNCA llama a Skydropx directo. Llama a esta función.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSkydropxToken, skydropxHost } from "../_shared/skydropx-auth.ts";

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

    // Verifica que quien llama sea un usuario autenticado real (no anon libre)
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader ?? "" } } }
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return json({ error: "No autorizado" }, 401);
    }

    const body = await req.json();
    const { origen, destino, paquete } = body;
    // origen/destino: { calle, numero, colonia, ciudad, estado, cp, nombre, telefono, email }
    // paquete: { peso_kg, largo_cm, ancho_cm, alto_cm, contenido }

    if (!origen?.cp || !destino?.cp || !paquete?.peso_kg) {
      return json({ error: "Faltan datos de origen, destino o paquete" }, 400);
    }

    // Resuelve CP → estado/municipio/colonia antes de cotizar
    let origenResuelto, destinoResuelto;
    try {
      origenResuelto = await resolverCP(origen.cp);
    } catch (e: any) {
      const status = e.message.includes("no existe") ? 400 : 503;
      return json({ error: e.message }, status);
    }
    try {
      destinoResuelto = await resolverCP(destino.cp);
    } catch (e: any) {
      const status = e.message.includes("no existe") ? 400 : 503;
      return json({ error: e.message }, status);
    }

    const token = await getSkydropxToken(supabaseAdmin);
    const host = skydropxHost();

    // 1. Crear cotización
    const quotationPayload = {
      quotation: {
        address_from: {
          country_code: "MX",
          postal_code: origen.cp,
          area_level1: origenResuelto.estado,
          area_level2: origenResuelto.municipio,
          area_level3: origenResuelto.colonia,
        },
        address_to: {
          country_code: "MX",
          postal_code: destino.cp,
          area_level1: destinoResuelto.estado,
          area_level2: destinoResuelto.municipio,
          area_level3: destinoResuelto.colonia,
        },
        parcels: [
          {
            weight: paquete.peso_kg,
            length: paquete.largo_cm,
            width: paquete.ancho_cm,
            height: paquete.alto_cm,
          },
        ],
      },
    };

    const createRes = await fetch(`${host}/api/v1/quotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(quotationPayload),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return json({ error: "Skydropx rechazó la cotización", detail: errText }, 502);
    }

    const created = await createRes.json();
    const quotationId = created.id ?? created.data?.id;

    // 2. Polling: la cotización se completa de forma progresiva
    let rates: any[] = [];
    let attempts = 0;
    while (attempts < 8) {
      await sleep(1200);
      const pollRes = await fetch(`${host}/api/v1/quotations/${quotationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pollJson = await pollRes.json();
      const data = pollJson.data ?? pollJson;

      rates = data.rates ?? [];
      if (data.is_completed) break;
      attempts++;
    }

    if (!rates.length) {
      return json({ error: "No se encontraron tarifas disponibles para esa ruta" }, 404);
    }

    // 3. Lee margen configurado
    const { data: config } = await supabaseAdmin
      .from("config_guias")
      .select("margen_porcentaje, margen_fijo")
      .single();

    const margenPct  = config?.margen_porcentaje ?? 0;
    const margenFijo = config?.margen_fijo ?? 0;

    // 4. Formatea para el comparador (ordenado por precio con margen aplicado)
    const opciones = rates
      .filter((r: any) => r.success !== false && (r.total ?? r.amount) != null)
      .map((r: any) => {
        const costoReal = parseFloat(r.total ?? r.amount);
        const costo     = Math.ceil(costoReal * (1 + margenPct / 100) + margenFijo);
        return {
          rate_id:    r.id,
          paqueteria: r.carrier_name ?? r.provider_name,
          servicio:   r.service_level_name ?? r.provider_service_name,
          costo,
          costoReal,
          dias_min: r.days ?? r.estimated_delivery_terms?.min,
          dias_max: r.days ?? r.estimated_delivery_terms?.max,
        };
      })
      .sort((a, b) => a.costo - b.costo)
      .map((o, i) => ({ ...o, medalla: ["🥇", "🥈", "🥉"][i] ?? "" }));

    return json({ quotation_id: quotationId, opciones });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolverCP(cp: string) {
  const res = await fetch(
    `https://postalia.com.mx/api/codigos-postales/${cp}`,
    { headers: { Authorization: `Bearer ${Deno.env.get("POSTALIA_TOKEN")}` } }
  );

  if (res.status === 401) {
    console.error("Postalia: token faltante o inválido");
    throw new Error("Hubo un problema al validar el código postal. Intenta de nuevo en unos minutos.");
  }
  if (res.status === 404) {
    throw new Error(`El código postal ${cp} no existe. Verifica que esté bien escrito.`);
  }
  if (res.status === 429) {
    console.error("Postalia: límite diario de consultas superado");
    throw new Error("Estamos recibiendo muchas solicitudes en este momento. Intenta de nuevo más tarde.");
  }
  if (!res.ok) {
    throw new Error(`No se pudo validar el código postal ${cp}.`);
  }

  const json = await res.json();
  return {
    estado:    json.estado,
    municipio: json.municipio,
    colonia:   json.colonias?.[0]?.nombre ?? json.municipio,
  };
}
