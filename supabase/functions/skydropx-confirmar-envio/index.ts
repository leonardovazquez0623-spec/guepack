// supabase/functions/skydropx-confirmar-envio/index.ts
// Recibe los datos del envío desde el cliente, re-valida el costo real
// contra Skydropx y hace el INSERT con service_role. Nunca confía en
// precios o rate_ids que vengan del body sin verificar.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSkydropxToken, skydropxHost } from "../_shared/skydropx-auth.ts";

const allowedOrigins = ["https://guepack.com", "https://www.guepack.com"]

const corsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin") ?? ""
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }
}

const EXTRAS_PRECIOS: Record<string, number> = {
  cajas:       35,
  seguro:      45,
};

const EXTRAS_PERMITIDOS = new Set(["recoleccion", ...Object.keys(EXTRAS_PRECIOS)]);
const PAQUETERIAS_RECOLECCION_APROXIMADA = new Set(["dhl", "fedex", "estafeta", "ups", "quiken"]);

function normalizarPaqueteria(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

type EstadoRecoleccionAproximada = "no_disponible" | "hoy" | "siguiente_dia_habil";

function obtenerEstadoRecoleccionAproximada(
  paqueteriaValor: unknown,
  servicioValor: unknown,
): EstadoRecoleccionAproximada {
  const paqueteria = normalizarPaqueteria(paqueteriaValor);
  if (!PAQUETERIAS_RECOLECCION_APROXIMADA.has(paqueteria)) return "no_disponible";

  const servicio = normalizarPaqueteria(servicioValor);
  if (
    (paqueteria === "paquetexpress" || paqueteria === "sendex") &&
    servicio.includes("sinrecoleccion")
  ) return "no_disponible";

  const partes = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  const dia = normalizarPaqueteria(valores.weekday);
  const hora = Number(valores.hour);
  const esFinDeSemana = dia === "sabado" || dia === "domingo";
  return !esFinDeSemana && hora < 12 ? "hoy" : "siguiente_dia_habil";
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
      .select("margen_porcentaje, margen_fijo, costo_recoleccion")
      .single();

    const margenPct  = config?.margen_porcentaje ?? 0;
    const margenFijo = config?.margen_fijo ?? 0;
    const costoRecoleccionConfigurado = Number(config?.costo_recoleccion);
    const costoRecoleccion = Number.isFinite(costoRecoleccionConfigurado) && costoRecoleccionConfigurado > 0
      ? costoRecoleccionConfigurado
      : 0;
    const costoEnvio     = Math.ceil(costoReal * (1 + margenPct / 100) + margenFijo);
    const margenAplicado = costoEnvio - costoReal;

    // 5. Mapea servicios adicionales a columnas individuales con precios del servidor.
    let extrasValidos: string[] = Array.isArray(extras_seleccionados)
      ? extras_seleccionados.filter((k: string) => EXTRAS_PERMITIDOS.has(k))
      : [];

    // La regla del wizard es aproximada; Skydropx confirma la cobertura después de crear la guía.
    const estadoRecoleccion = obtenerEstadoRecoleccionAproximada(
      rate.carrier_name ?? rate.provider_name,
      rate.service_level_name ?? rate.provider_service_name,
    );
    if (
      extrasValidos.includes("recoleccion") &&
      (estadoRecoleccion === "no_disponible" || costoRecoleccion <= 0)
    ) {
      extrasValidos = extrasValidos.filter(k => k !== "recoleccion");
    }

    const costoExtras = extrasValidos.reduce(
      (suma, clave) => suma + (clave === "recoleccion" ? costoRecoleccion : EXTRAS_PRECIOS[clave]),
      0,
    );

    const extrasColumnas = {
      recoleccion_domicilio: extrasValidos.includes("recoleccion"),
      recoleccion_costo:     extrasValidos.includes("recoleccion") ? costoRecoleccion : 0,
      seguro_adicional:      extrasValidos.includes("seguro"),
      seguro_costo:          extrasValidos.includes("seguro")      ? EXTRAS_PRECIOS.seguro      : 0,
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
