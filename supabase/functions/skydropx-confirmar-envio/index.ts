// supabase/functions/skydropx-confirmar-envio/index.ts
// Recibe los datos del envío desde el cliente, re-valida el costo real
// contra Skydropx y hace el INSERT con service_role. Nunca confía en
// precios o rate_ids que vengan del body sin verificar.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSkydropxToken, skydropxHost } from "../_shared/skydropx-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXTRAS_PRECIOS: Record<string, number> = {
  recoleccion: 60,
  cajas:       35,
  seguro:      45,
  prioritario: 80,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Valida auth
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader ?? "" } } }
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) return json({ error: "No autorizado" }, 401);

    // 2. Parsea body
    const { quotation_id, rate_id, direcciones, paquete, extras_seleccionados, comprobante_pago_url } = await req.json();

    if (!quotation_id || !rate_id || !direcciones || !paquete) {
      return json({ error: "Faltan datos requeridos (quotation_id, rate_id, direcciones, paquete)" }, 400);
    }

    // 3. Re-valida el costo real consultando Skydropx (nunca confía en el cliente)
    const token = await getSkydropxToken(supabaseAdmin);
    const host  = skydropxHost();

    const qRes = await fetch(`${host}/api/v1/quotations/${quotation_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!qRes.ok) {
      return json({ error: "Cotización expirada, vuelve a cotizar" }, 409);
    }

    const qJson  = await qRes.json();
    const qData  = qJson.data ?? qJson;
    const rates: any[] = qData.rates ?? [];

    const rate = rates.find((r: any) => String(r.id) === String(rate_id));
    if (!rate || rate.success === false) {
      return json({ error: "Cotización expirada, vuelve a cotizar" }, 409);
    }

    const costoReal = parseFloat(rate.total ?? rate.amount);

    // 4. Lee config_guias y aplica margen (misma fórmula que skydropx-cotizar)
    const { data: config } = await supabaseAdmin
      .from("config_guias")
      .select("margen_porcentaje, margen_fijo")
      .single();

    const margenPct  = config?.margen_porcentaje ?? 0;
    const margenFijo = config?.margen_fijo ?? 0;
    const costoEnvio     = Math.ceil(costoReal * (1 + margenPct / 100) + margenFijo);
    const margenAplicado = costoEnvio - costoReal;

    // 5. Mapea extras a columnas individuales (precios fijos del servidor)
    const extrasValidos: string[] = Array.isArray(extras_seleccionados)
      ? extras_seleccionados.filter((k: string) => k in EXTRAS_PRECIOS)
      : [];
    const costoExtras = extrasValidos.reduce((sum, k) => sum + EXTRAS_PRECIOS[k], 0);

    const extrasColumnas = {
      recoleccion_domicilio: extrasValidos.includes("recoleccion"),
      recoleccion_costo:     extrasValidos.includes("recoleccion") ? EXTRAS_PRECIOS.recoleccion : 0,
      seguro_adicional:      extrasValidos.includes("seguro"),
      seguro_costo:          extrasValidos.includes("seguro")      ? EXTRAS_PRECIOS.seguro      : 0,
      envio_prioritario:     extrasValidos.includes("prioritario"),
      prioritario_costo:     extrasValidos.includes("prioritario") ? EXTRAS_PRECIOS.prioritario : 0,
      costo_cajas_sobres:    extrasValidos.includes("cajas")       ? EXTRAS_PRECIOS.cajas       : 0,
    };

    // 6. Total final
    const costoTotal = costoEnvio + costoExtras;

    const { origen, destino, cp_origen, cp_destino } = direcciones;

    // 7. INSERT con service_role
    const { data: envio, error: insertErr } = await supabaseAdmin
      .from("envios_nacionales")
      .insert({
        user_id: user.id,
        // Origen
        origen_nombre:     origen.nombre,    origen_telefono:   origen.telefono,  origen_email:    origen.email    ?? null,
        origen_calle:      origen.calle,     origen_numero:     origen.numero    ?? null, origen_colonia:  origen.colonia,
        origen_ciudad:     origen.ciudad,    origen_estado:     origen.estado,    origen_cp:       cp_origen,
        origen_referencia: origen.referencia ?? null,
        // Destino
        destino_nombre:     destino.nombre,   destino_telefono:  destino.telefono, destino_email:   destino.email   ?? null,
        destino_calle:      destino.calle,    destino_numero:    destino.numero   ?? null, destino_colonia: destino.colonia,
        destino_ciudad:     destino.ciudad,   destino_estado:    destino.estado,   destino_cp:      cp_destino,
        destino_referencia: destino.referencia ?? null,
        // Paquete
        peso_kg:  paquete.peso_kg,  largo_cm: paquete.largo_cm,
        ancho_cm: paquete.ancho_cm, alto_cm:  paquete.alto_cm,
        contenido:        paquete.contenido,
        consignment_note: paquete.contenido,
        // Skydropx (tomados del rate real, no del cliente)
        skydropx_quotation_id: quotation_id,
        skydropx_rate_id:      rate_id,
        paqueteria: rate.carrier_name ?? rate.provider_name,
        servicio:   rate.service_level_name ?? rate.provider_service_name ?? null,
        // Precios (todos calculados en servidor)
        costo_skydropx_real: costoReal,
        margen_aplicado:     margenAplicado,
        costo_envio:         costoEnvio,
        ...extrasColumnas,
        costo_total:         costoTotal,
        comprobante_pago:    comprobante_pago_url ?? null,
        estado:              "pendiente_pago",
      })
      .select("id")
      .single();

    if (insertErr) {
      return json({ error: "Error al guardar el envío: " + insertErr.message }, 500);
    }

    // 8. Responde con el ID generado
    return json({ ok: true, envio_id: envio.id });

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
