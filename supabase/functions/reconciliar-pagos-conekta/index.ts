// supabase/functions/reconciliar-pagos-conekta/index.ts
// Red de seguridad ante webhooks de Conekta perdidos (timeouts, caídas,
// reintentos agotados). Corre por pg_cron cada 10 minutos: busca envíos
// nacionales atorados en pendiente_pago con checkout de Conekta y consulta
// directamente a Conekta si ya se pagaron. Exclusivo para el cron — no
// acepta JWT de usuario.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { procesarPagoEnvioNacional } from "../_shared/procesar-pago-envio.ts";

const REMITENTE = "GUEPACK Express <hola@guepack.com>";
const RESEND_URL = "https://api.resend.com/emails";

const CINCO_MINUTOS_MS = 5 * 60 * 1000;
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const LIMITE_CANDIDATOS = 50;

type Candidato = {
  id: number;
  conekta_checkout_id: string;
  costo_total: number | null;
  created_at: string;
};

async function enviarAlertaGuiaPendiente(
  resendApiKey: string,
  envioId: number,
  errorSkydropx: string,
) {
  const fecha = new Date().toISOString().slice(0, 10);
  const texto =
    `Se confirmó el pago del envío #${envioId} mediante la reconciliación ` +
    `automática con Conekta, pero Skydropx no pudo generar la guía.\n\n` +
    `Error de Skydropx: ${errorSkydropx}\n\n` +
    `Revisa este envío manualmente en: https://www.guepack.com/superadmin.html`;

  const respuesta = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `reconciliacion/${envioId}/${fecha}`,
    },
    body: JSON.stringify({
      from: REMITENTE,
      to: ["leonardo.vazquez0623@gmail.com"],
      subject: `⚠️ Guía pendiente de revisión manual - Envío #${envioId}`,
      text: texto,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Resend respondió ${respuesta.status}: ${detalle}`);
  }
}

// El shape documentado por Conekta para /checkouts no está validado contra
// una respuesta real de producción. Probamos varias rutas conocidas y, si
// hace falta, consultamos /orders/{id} como respaldo. Loggeamos el JSON
// crudo siempre para poder ajustar el parseo si Conekta difiere.
async function consultarPagoCheckout(
  checkoutId: string,
  basicAuth: string,
): Promise<boolean> {
  const res = await fetch(`https://api.conekta.io/checkouts/${checkoutId}`, {
    headers: {
      accept: "application/vnd.conekta-v2.2.0+json",
      Authorization: `Basic ${basicAuth}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Conekta respondió ${res.status} al consultar el checkout: ${errText}`);
  }

  const checkout = await res.json();
  console.log(
    `[reconciliar-pagos-conekta] Respuesta cruda de checkout ${checkoutId}:`,
    JSON.stringify(checkout),
  );

  let order = checkout.order ?? checkout.data?.order ?? null;
  const orderId = order?.id ?? checkout.order_id ?? checkout.data?.order_id ?? null;

  if (!order?.payment_status && orderId) {
    const resOrder = await fetch(`https://api.conekta.io/orders/${orderId}`, {
      headers: {
        accept: "application/vnd.conekta-v2.2.0+json",
        Authorization: `Basic ${basicAuth}`,
      },
    });

    if (resOrder.ok) {
      order = await resOrder.json();
      console.log(
        `[reconciliar-pagos-conekta] Respuesta cruda de order ${orderId}:`,
        JSON.stringify(order),
      );
    } else {
      console.error(
        `[reconciliar-pagos-conekta] No se pudo consultar order ${orderId}: HTTP ${resOrder.status}`,
      );
    }
  }

  const paymentStatus = order?.payment_status ?? checkout.payment_status ?? checkout.status;
  return paymentStatus === "paid";
}

serve(async (_req) => {
  const claveServicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    claveServicio,
  );

  const conektaPrivateKey = Deno.env.get("CONEKTA_PRIVATE_KEY")!;
  const basicAuth = btoa(`${conektaPrivateKey}:`);
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";

  const ahora = Date.now();
  const cortaMinAntes = new Date(ahora - CINCO_MINUTOS_MS).toISOString();
  const corteMaxAntes = new Date(ahora - SIETE_DIAS_MS).toISOString();

  const { data: candidatos, error: errorCandidatos } = await supabaseAdmin
    .from("envios_nacionales")
    .select("id, conekta_checkout_id, costo_total, created_at")
    .eq("estado", "pendiente_pago")
    .not("conekta_checkout_id", "is", null)
    .lt("created_at", cortaMinAntes)
    .gt("created_at", corteMaxAntes)
    .order("created_at", { ascending: true })
    .limit(LIMITE_CANDIDATOS);

  if (errorCandidatos) {
    console.error("[reconciliar-pagos-conekta] Error consultando candidatos:", errorCandidatos.message);
    return new Response(
      JSON.stringify({ ok: false, error: errorCandidatos.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const lista = (candidatos ?? []) as Candidato[];

  if (lista.length === 0) {
    return new Response(JSON.stringify({ ok: true, revisados: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  let reconciliados = 0;
  let fallidos = 0;
  const idsReconciliados: number[] = [];
  const idsFallidos: number[] = [];

  for (const candidato of lista) {
    try {
      let pagado: boolean;
      try {
        pagado = await consultarPagoCheckout(candidato.conekta_checkout_id, basicAuth);
      } catch (e: any) {
        console.error(
          `[reconciliar-pagos-conekta] Error consultando checkout de envío ${candidato.id} en Conekta:`,
          e.message,
        );
        fallidos++;
        idsFallidos.push(candidato.id);
        continue;
      }

      if (!pagado) continue;

      // Verificación de carrera: re-lee el estado fresco antes de procesar,
      // por si un webhook está llegando en paralelo justo en este momento.
      const { data: fresco, error: errorFresco } = await supabaseAdmin
        .from("envios_nacionales")
        .select("estado")
        .eq("id", candidato.id)
        .maybeSingle();

      if (errorFresco || !fresco || fresco.estado !== "pendiente_pago") {
        console.log(
          `[reconciliar-pagos-conekta] Envío ${candidato.id} ya cambió de estado, se omite`,
        );
        continue;
      }

      let resultado: { ok: boolean; error?: string };
      try {
        resultado = await procesarPagoEnvioNacional(supabaseAdmin, candidato.id);
      } catch (e: any) {
        resultado = { ok: false, error: e.message };
      }

      if (resultado.ok) {
        reconciliados++;
        idsReconciliados.push(candidato.id);
        console.log(`[reconciliar-pagos-conekta] Envío ${candidato.id} reconciliado correctamente`);
      } else {
        fallidos++;
        idsFallidos.push(candidato.id);
        try {
          await enviarAlertaGuiaPendiente(
            resendApiKey,
            candidato.id,
            resultado.error ?? "Error desconocido",
          );
        } catch (e: any) {
          console.error(
            `[reconciliar-pagos-conekta] No se pudo enviar la alerta por correo para el envío ${candidato.id}:`,
            e.message,
          );
        }
      }
    } catch (e: any) {
      console.error(
        `[reconciliar-pagos-conekta] Error inesperado procesando envío ${candidato.id}:`,
        e.message,
      );
      fallidos++;
      idsFallidos.push(candidato.id);
    }
  }

  const { error: errorLog } = await supabaseAdmin.from("admin_log").insert({
    admin_email: "sistema@guepack.mx",
    accion: "reconciliacion_pagos_conekta",
    detalle: {
      revisados: lista.length,
      reconciliados,
      fallidos,
      ids_reconciliados: idsReconciliados,
      ids_fallidos: idsFallidos,
    },
  });

  if (errorLog) {
    console.error("[reconciliar-pagos-conekta] No se pudo registrar el admin_log:", errorLog.message);
  }

  return new Response(
    JSON.stringify({ ok: true, revisados: lista.length, reconciliados, fallidos }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
