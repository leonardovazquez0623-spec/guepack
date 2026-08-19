// _shared/procesar-pago-envio.ts
// Lógica compartida para confirmar el pago de un envío nacional y disparar
// la generación de guía en Skydropx. La usan conekta-webhook (al recibir el
// evento en tiempo real) y reconciliar-pagos-conekta (red de seguridad por
// pg_cron ante webhooks perdidos).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function procesarPagoEnvioNacional(
  supabaseAdmin: SupabaseClient,
  envioId: string | number,
): Promise<{ ok: boolean; error?: string }> {
  const { error: updateErr } = await supabaseAdmin
    .from("envios_nacionales")
    .update({
      pago_verificado: true,
      pago_verificado_at: new Date().toISOString(),
      metodo_pago: "tarjeta",
    })
    .eq("id", envioId);

  if (updateErr) {
    throw new Error(`Error actualizando el pago verificado: ${updateErr.message}`);
  }

  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/enviar-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        tipo_notificacion: "interno_pago_confirmado",
        envio_id: Number(envioId),
      }),
    });
  } catch (e: any) {
    console.error("Error enviando push de pago confirmado:", e.message);
  }

  const guiaRes = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/skydropx-generar-guia`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": Deno.env.get("INTERNAL_FUNCTIONS_SECRET") ?? "",
      },
      body: JSON.stringify({ envio_id: envioId }),
    },
  );

  if (!guiaRes.ok) {
    const errText = await guiaRes.text();
    console.error("Error generando guia para envio_id", envioId, ":", errText);

    await supabaseAdmin
      .from("envios_nacionales")
      .update({
        estado: "pago_recibido_guia_pendiente",
        error_generacion_guia: errText,
      })
      .eq("id", envioId);

    return { ok: false, error: `Skydropx no pudo generar la guía: ${errText}` };
  }

  const guiaJson = await guiaRes.json();
  console.log("Guia generada automaticamente:", JSON.stringify(guiaJson));

  return { ok: true };
}
