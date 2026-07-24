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
const MARCA_RECOLECCION_MANUAL = "PENDIENTE_MANUAL";

function obtenerVentanasRecoleccion(respuesta: any) {
  const fechas = respuesta?.pickupDates ?? respuesta?.data?.pickupDates ?? [];
  if (!Array.isArray(fechas)) return [];
  return fechas
    .filter((fecha: any) => fecha?.date && fecha?.startHour && fecha?.endHour)
    .sort((a: any, b: any) =>
      `${a.date}T${a.startHour}`.localeCompare(`${b.date}T${b.startHour}`)
    );
}

async function marcarRecoleccionManual(
  supabaseAdmin: any,
  envio: any,
  idEnvioSkydropx: string,
  motivo: string,
) {
  const { error: errorMarca } = await supabaseAdmin
    .from("envios_nacionales")
    .update({ recoleccion_request_number: MARCA_RECOLECCION_MANUAL })
    .eq("id", envio.id);

  if (errorMarca) {
    console.error("[skydropx-generar-guia] No se pudo marcar la recolección manual:", errorMarca.message);
  }

  const { error: errorBitacora } = await supabaseAdmin
    .from("admin_log")
    .insert({
      admin_email: "sistema@guepack.mx",
      accion: "recoleccion_skydropx_pendiente_manual",
      detalle: {
        envio_nacional_id: envio.id,
        skydropx_shipment_id: idEnvioSkydropx,
        paqueteria: envio.paqueteria,
        motivo,
      },
    });

  if (errorBitacora) {
    console.error("[skydropx-generar-guia] No se pudo registrar el fallo de recolección:", errorBitacora.message);
  }
}

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

    const estadoAnterior = envio.estado;
    const { data: reservaGuia, error: errorReserva } = await supabaseAdmin
      .from("envios_nacionales")
      .update({ estado: "generando_guia" })
      .eq("id", envio_id)
      .neq("estado", "generando_guia")
      .is("numero_guia", null)
      .select("id")
      .maybeSingle();

    if (errorReserva) {
      console.error("[skydropx-generar-guia] No se pudo reservar la generación de guía:", errorReserva.message);
      return json({ error: "No se pudo iniciar la generación de la guía" }, 500);
    }

    if (!reservaGuia) {
      return json({
        error: "Ya hay una generación de guía en curso para este envío, intenta de nuevo en unos segundos",
      }, 409);
    }

    const liberarReservaGuia = async (motivo: string) => {
      const { error: errorLiberarReserva } = await supabaseAdmin
        .from("envios_nacionales")
        .update({ estado: estadoAnterior })
        .eq("id", envio_id)
        .eq("estado", "generando_guia")
        .is("numero_guia", null);

      if (errorLiberarReserva) {
        console.error(
          `[skydropx-generar-guia] No se pudo liberar la reserva ${motivo}:`,
          errorLiberarReserva.message,
        );
      }
    };

    const host = skydropxHost();

    // 2. Crea el envío (guía) en Skydropx
    const shipmentPayload = {
      shipment: {
        quotation_id: envio.skydropx_quotation_id,
        rate_id: envio.skydropx_rate_id,
        unique_shipment: true,
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

    let token: string;
    let res: Response;
    try {
      token = await getSkydropxToken(supabaseAdmin);
      res = await fetch(`${host}/api/v1/shipments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(shipmentPayload),
      });
    } catch (e: any) {
      await liberarReservaGuia("después de un error de conexión con Skydropx");
      return json({
        error: "No fue posible comunicarse con Skydropx",
        detail: e.message,
      }, 502);
    }

    if (!res.ok) {
      const errText = await res.text();
      await liberarReservaGuia("después del rechazo de Skydropx");

      if (res.status === 409) {
        return json({
          error: "Ya hay una generación de guía en curso para este envío, intenta de nuevo en unos segundos",
        }, 409);
      }

      return json({ error: "Skydropx rechazó la creación del envío", detail: errText }, 502);
    }

    let shipment: any;
    try {
      shipment = await res.json();
    } catch (e: any) {
      await liberarReservaGuia("después de recibir una respuesta inválida de Skydropx");
      return json({
        error: "Skydropx respondió sin datos válidos de la guía",
        detail: e.message,
      }, 502);
    }
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

    if (updateErr) {
      const numeroGuiaGenerada = data.tracking_number ?? data.attributes?.tracking_number;
      const idEnvioSkydropx = data.id;
      const detalleError =
        `Guía creada en Skydropx pero no guardada localmente. ` +
        `numero_guia=${numeroGuiaGenerada ?? "no devuelto"}, ` +
        `skydropx_shipment_id=${idEnvioSkydropx ?? "no devuelto"}, ` +
        `motivo=${updateErr.message}`;

      console.error("[skydropx-generar-guia]", detalleError);

      const { error: errorMarcarRevision } = await supabaseAdmin
        .from("envios_nacionales")
        .update({
          estado: "guia_generada_pendiente_guardado",
          error_generacion_guia: detalleError,
        })
        .eq("id", envio_id)
        .eq("estado", "generando_guia");

      if (errorMarcarRevision) {
        console.error(
          "[skydropx-generar-guia] Tampoco fue posible marcar el envío para revisión manual:",
          errorMarcarRevision.message,
        );
      }

      return json({
        error: "La guía fue creada, pero no se pudo guardar localmente. Se requiere revisión manual.",
      }, 500);
    }

    let recoleccionPendienteManual = false;

    // Skydropx es la autoridad final para la cobertura y las ventanas de recolección.
    if (envio.recoleccion_domicilio === true) {
      try {
        const respuestaCobertura = await fetch(
          `${host}/api/v1/pickups/coverage?shipment_id=${encodeURIComponent(data.id)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const cuerpoCobertura = await respuestaCobertura.json().catch(() => ({}));

        if (!respuestaCobertura.ok) {
          throw new Error(
            `Skydropx rechazó la consulta de cobertura (${respuestaCobertura.status}): ${
              cuerpoCobertura?.message ?? JSON.stringify(cuerpoCobertura)
            }`
          );
        }

        const ventanas = obtenerVentanasRecoleccion(cuerpoCobertura);
        const coberturaExitosa = cuerpoCobertura?.success ?? cuerpoCobertura?.data?.success;
        if (coberturaExitosa !== true || ventanas.length === 0) {
          throw new Error(cuerpoCobertura?.message || "Skydropx no devolvió ventanas disponibles");
        }

        const ventana = ventanas[0];
        const respuestaRecoleccion = await fetch(`${host}/api/v1/pickups/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            pickup: {
              reference_shipment_id: data.id,
              packages: 1,
              total_weight: Number(envio.peso_kg),
              scheduled_from: `${ventana.date} ${ventana.startHour}`,
              scheduled_to: `${ventana.date} ${ventana.endHour}`,
            },
          }),
        });
        const cuerpoRecoleccion = await respuestaRecoleccion.json().catch(() => ({}));

        if (!respuestaRecoleccion.ok) {
          throw new Error(
            `Skydropx rechazó la recolección (${respuestaRecoleccion.status}): ${
              cuerpoRecoleccion?.message ?? JSON.stringify(cuerpoRecoleccion)
            }`
          );
        }

        const atributosRecoleccion = cuerpoRecoleccion?.data?.attributes ?? cuerpoRecoleccion?.attributes ?? {};
        const numeroSolicitud = atributosRecoleccion.request_number;
        if (!numeroSolicitud) {
          throw new Error("Skydropx creó la recolección sin devolver request_number");
        }

        const { error: errorGuardarRecoleccion } = await supabaseAdmin
          .from("envios_nacionales")
          .update({ recoleccion_request_number: numeroSolicitud })
          .eq("id", envio_id);

        if (errorGuardarRecoleccion) {
          console.error(
            "[skydropx-generar-guia] La recolección se creó, pero no se guardó su folio:",
            errorGuardarRecoleccion.message,
          );
          await supabaseAdmin.from("admin_log").insert({
            admin_email: "sistema@guepack.mx",
            accion: "recoleccion_skydropx_folio_no_guardado",
            detalle: {
              envio_nacional_id: envio_id,
              skydropx_shipment_id: data.id,
              recoleccion_request_number: numeroSolicitud,
              motivo: errorGuardarRecoleccion.message,
            },
          });
        } else {
          console.log(
            "[skydropx-generar-guia] Recolección programada correctamente:",
            numeroSolicitud,
          );
        }
      } catch (e: any) {
        recoleccionPendienteManual = true;
        console.error("[skydropx-generar-guia] La guía se generó, pero la recolección requiere agenda manual:", e.message);
        await marcarRecoleccionManual(supabaseAdmin, envio, data.id, e.message);
      }
    }

    if (envio.user_id) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/enviar-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: JSON.stringify({
            tipo_notificacion: "interno_guia_generada",
            envio_id: Number(envio_id),
          }),
        });
      } catch (e: any) {
        console.error("[skydropx-generar-guia] Error enviando push guía lista:", e.message);
      }
    }

    return json({
      ok: true,
      numero_guia: data.tracking_number,
      label_url: data.label_url,
      tracking_url: data.tracking_url,
      recoleccion_pendiente_manual: recoleccionPendienteManual,
      aviso: recoleccionPendienteManual
        ? "La guía se generó, pero la recolección debe agendarse manualmente."
        : null,
    });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
