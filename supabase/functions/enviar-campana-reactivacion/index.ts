import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Segmento = "nunca_pidieron" | "inactivos";

type CuerpoSolicitud = {
  segmento?: unknown;
  modo_prueba?: unknown;
  email_prueba?: unknown;
};

type PerfilAdministrador = {
  rol: string | null;
  tenant_id: number | null;
  es_superadmin: boolean | null;
};

type ClienteCampana = {
  user_id: string;
  email: string;
  nombre: string | null;
  tenant_id: number;
};

type DetalleFallido = {
  user_id: string | null;
  email: string;
  etapa: string;
  error: string;
  requiere_revision_manual?: boolean;
};

const ORIGENES_PERMITIDOS = [
  "https://guepack.com",
  "https://www.guepack.com",
];

const REMITENTE = "GUEPACK Express <hola@guepack.com>";
const RESEND_URL = "https://api.resend.com/emails";
const TAMANO_PAGINA = 500;

function encabezadosCors(req: Request) {
  const origen = req.headers.get("Origin") ?? "";
  const permitido = ORIGENES_PERMITIDOS.includes(origen)
    ? origen
    : ORIGENES_PERMITIDOS[0];

  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function responderJson(req: Request, contenido: unknown, estado = 200) {
  return new Response(JSON.stringify(contenido), {
    status: estado,
    headers: {
      ...encabezadosCors(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function esSegmento(valor: unknown): valor is Segmento {
  return valor === "nunca_pidieron" || valor === "inactivos";
}

function esEmailValido(valor: unknown): valor is string {
  if (typeof valor !== "string") return false;
  const email = valor.trim();
  return email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function mensajeError(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error
  ) {
    return String((error as { message: unknown }).message);
  }

  return String(error);
}

function escaparHtml(valor: string): string {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fechaLocalMexico(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const obtener = (tipo: string) =>
    partes.find((parte) => parte.type === tipo)?.value ?? "";

  return `${obtener("year")}-${obtener("month")}-${obtener("day")}`;
}

function sumarDiasFecha(fechaIso: string, dias: number): string {
  const [anio, mes, dia] = fechaIso.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia, 12));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function generarCodigoCupon(
  segmento: Segmento,
  esPrueba: boolean,
): string {
  const prefijoSegmento = segmento === "nunca_pidieron" ? "NUEVO" : "VUELVE";
  const parteAleatoria = crypto.randomUUID()
    .replaceAll("-", "")
    .slice(0, 10)
    .toUpperCase();

  return esPrueba
    ? `TEST15-${prefijoSegmento}-${parteAleatoria}`
    : `GP15-${prefijoSegmento}-${parteAleatoria}`;
}

function construirCorreo(
  segmento: Segmento,
  nombre: string | null,
  codigo: string,
  esPrueba: boolean,
) {
  const nombreLimpio = typeof nombre === "string" && nombre.trim()
    ? nombre.trim()
    : null;
  const saludoHtml = nombreLimpio
    ? `Hola, ${escaparHtml(nombreLimpio)}`
    : "¡Hola!";
  const saludoTexto = nombreLimpio ? `Hola, ${nombreLimpio}` : "¡Hola!";
  const codigoHtml = escaparHtml(codigo);

  const distintivoPruebaHtml = esPrueba
    ? `
      <div style="margin:0 0 20px;padding:10px 14px;background:#fff4ed;border:1px solid #F05A1A;border-radius:8px;color:#9a3412;font-size:13px;font-weight:700;text-align:center;">
        CORREO DE PRUEBA — no pertenece a un cliente real
      </div>
    `
    : "";
  const distintivoPruebaTexto = esPrueba
    ? "CORREO DE PRUEBA — no pertenece a un cliente real\n\n"
    : "";

  if (segmento === "nunca_pidieron") {
    return {
      subject: esPrueba
        ? "[PRUEBA] Tu primer envío con GUEPACK tiene 15% de descuento"
        : "Tu primer envío con GUEPACK tiene 15% de descuento",
      html: `
        <!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Tu primer envío con GUEPACK</title>
          </head>
          <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:24px 12px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
                    <tr>
                      <td style="background:#1E56C7;padding:24px;text-align:center;color:#ffffff;">
                        <div style="font-size:25px;font-weight:800;">GUEPACK Express</div>
                        <div style="margin-top:6px;font-size:14px;">Envíos locales fáciles y rápidos</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:30px 28px;">
                        ${distintivoPruebaHtml}
                        <h1 style="margin:0 0 18px;font-size:23px;color:#1E56C7;">${saludoHtml}</h1>
                        <p style="margin:0 0 16px;line-height:1.65;">
                          Nos encantaría ayudarte con tu primer envío. Con GUEPACK puedes solicitar tu servicio de forma sencilla y dar seguimiento a tu paquete.
                        </p>
                        <p style="margin:0 0 20px;line-height:1.65;">
                          Para darte la bienvenida, tienes un <strong>15% de descuento</strong> en tu próximo pedido.
                        </p>
                        <div style="margin:24px 0;padding:22px;background:#eef4ff;border:2px dashed #1E56C7;border-radius:12px;text-align:center;">
                          <div style="font-size:13px;color:#4b5563;text-transform:uppercase;letter-spacing:1px;">Tu código</div>
                          <div style="margin-top:8px;font-size:25px;font-weight:800;color:#F05A1A;letter-spacing:1px;">${codigoHtml}</div>
                        </div>
                        <p style="margin:0 0 12px;line-height:1.65;">
                          El cupón es de un solo uso y estará disponible durante <strong>7 días</strong>. Cuando estés listo, ingrésalo al solicitar tu envío.
                        </p>
                        <p style="margin:24px 0 0;line-height:1.65;">¡Esperamos acompañarte en tu primer envío!</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 28px;background:#f8fafc;text-align:center;font-size:12px;color:#6b7280;">
                        GUEPACK Express · Este correo fue enviado porque tienes una cuenta de cliente.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
      text: `${distintivoPruebaTexto}${saludoTexto}

Nos encantaría ayudarte con tu primer envío.

Para darte la bienvenida, tienes un 15% de descuento en tu próximo pedido.

Tu código: ${codigo}

El cupón es de un solo uso y estará disponible durante 7 días.

¡Esperamos acompañarte en tu primer envío!

GUEPACK Express`,
    };
  }

  return {
    subject: esPrueba
      ? "[PRUEBA] Te extrañamos: vuelve con 15% de descuento"
      : "Te extrañamos: vuelve con 15% de descuento",
    html: `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Te extrañamos en GUEPACK</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:24px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
                  <tr>
                    <td style="background:#1E56C7;padding:24px;text-align:center;color:#ffffff;">
                      <div style="font-size:25px;font-weight:800;">GUEPACK Express</div>
                      <div style="margin-top:6px;font-size:14px;">Queremos volver a ayudarte</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:30px 28px;">
                      ${distintivoPruebaHtml}
                      <h1 style="margin:0 0 18px;font-size:23px;color:#1E56C7;">${saludoHtml}</h1>
                      <p style="margin:0 0 16px;line-height:1.65;">
                        Ha pasado un tiempo desde tu último envío y te extrañamos. Queremos que volver a usar GUEPACK sea todavía más fácil.
                      </p>
                      <p style="margin:0 0 20px;line-height:1.65;">
                        Por eso tienes un <strong>15% de descuento</strong> para tu próximo pedido.
                      </p>
                      <div style="margin:24px 0;padding:22px;background:#eef4ff;border:2px dashed #1E56C7;border-radius:12px;text-align:center;">
                        <div style="font-size:13px;color:#4b5563;text-transform:uppercase;letter-spacing:1px;">Tu código</div>
                        <div style="margin-top:8px;font-size:25px;font-weight:800;color:#F05A1A;letter-spacing:1px;">${codigoHtml}</div>
                      </div>
                      <p style="margin:0 0 12px;line-height:1.65;">
                        El cupón es de un solo uso y estará vigente durante <strong>7 días</strong>. Úsalo cuando solicites tu próximo envío.
                      </p>
                      <p style="margin:24px 0 0;line-height:1.65;">Será un gusto volver a llevar tus envíos.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 28px;background:#f8fafc;text-align:center;font-size:12px;color:#6b7280;">
                      GUEPACK Express · Este correo fue enviado porque tienes una cuenta de cliente.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    text: `${distintivoPruebaTexto}${saludoTexto}

Ha pasado un tiempo desde tu último envío y te extrañamos.

Queremos invitarte a volver con un 15% de descuento en tu próximo pedido.

Tu código: ${codigo}

El cupón es de un solo uso y estará vigente durante 7 días.

Será un gusto volver a llevar tus envíos.

GUEPACK Express`,
  };
}

async function enviarConResend(params: {
  apiKey: string;
  destinatario: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}) {
  const respuesta = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      from: REMITENTE,
      to: [params.destinatario],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  let resultado: unknown = null;
  try {
    resultado = await respuesta.json();
  } catch {
    resultado = null;
  }

  if (!respuesta.ok) {
    const detalle = typeof resultado === "object" &&
        resultado !== null &&
        "message" in resultado
      ? String((resultado as { message: unknown }).message)
      : `Resend respondió HTTP ${respuesta.status}`;
    throw new Error(detalle);
  }

  if (
    typeof resultado !== "object" ||
    resultado === null ||
    !("id" in resultado)
  ) {
    throw new Error("Resend aceptó la solicitud sin devolver un id de correo");
  }

  return String((resultado as { id: unknown }).id);
}

async function obtenerClientes(
  supabaseAdmin: any,
  segmento: Segmento,
  tenantId: number | null,
): Promise<ClienteCampana[]> {
  const clientes: ClienteCampana[] = [];
  let desde = 0;

  while (true) {
    const hasta = desde + TAMANO_PAGINA - 1;
    const { data, error } = await supabaseAdmin
      .rpc("listar_clientes_reactivacion", {
        p_segmento: segmento,
        p_tenant_id: tenantId,
      })
      .range(desde, hasta);

    if (error) {
      throw new Error(`No se pudo consultar el segmento: ${error.message}`);
    }

    const pagina = (data ?? []) as ClienteCampana[];
    clientes.push(...pagina);
    if (pagina.length < TAMANO_PAGINA) break;
    desde += TAMANO_PAGINA;
  }

  return clientes;
}

async function insertarCuponConReintento(
  supabaseAdmin: any,
  params: {
    segmento: Segmento;
    tenantId: number;
    fechaExpiracion: string;
    esPrueba: boolean;
  },
): Promise<string> {
  for (let intento = 1; intento <= 5; intento++) {
    const codigo = generarCodigoCupon(params.segmento, params.esPrueba);
    const { error } = await supabaseAdmin
      .from("cupones")
      .insert({
        codigo,
        tipo: "porcentaje",
        descuento: 15,
        usos_maximos: 1,
        usos_actuales: 0,
        usos_por_usuario: 1,
        fecha_expiracion: params.fechaExpiracion,
        tenant_id: params.tenantId,
      });

    if (!error) return codigo;
    if (error.code !== "23505") {
      throw new Error(`No se pudo crear el cupón: ${error.message}`);
    }
  }

  throw new Error(
    "No fue posible generar un código de cupón único después de varios intentos",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: encabezadosCors(req) });
  }

  if (req.method !== "POST") {
    return responderJson(req, { error: "Método no permitido" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL");
  const claveServicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY");
  const claveAnonima = Deno.env.get("SUPABASE_ANON_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!supabaseUrl || !claveServicio || !claveAnonima || !resendApiKey) {
    console.error(
      "[enviar-campana-reactivacion] Faltan variables de entorno",
    );
    return responderJson(
      req,
      { error: "Configuración interna incompleta" },
      500,
    );
  }

  const tokenJwt = (req.headers.get("Authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!tokenJwt) {
    return responderJson(req, { error: "No autorizado" }, 401);
  }

  let cuerpo: CuerpoSolicitud;
  try {
    cuerpo = await req.json();
  } catch {
    return responderJson(
      req,
      { error: "El cuerpo de la solicitud no es JSON válido" },
      400,
    );
  }

  if (!esSegmento(cuerpo.segmento)) {
    return responderJson(
      req,
      { error: "segmento debe ser 'nunca_pidieron' o 'inactivos'" },
      400,
    );
  }
  if (typeof cuerpo.modo_prueba !== "boolean") {
    return responderJson(
      req,
      { error: "modo_prueba debe ser boolean" },
      400,
    );
  }
  if (cuerpo.modo_prueba && !esEmailValido(cuerpo.email_prueba)) {
    return responderJson(
      req,
      {
        error:
          "email_prueba es obligatorio y debe ser un email válido cuando modo_prueba=true",
      },
      400,
    );
  }

  const segmento = cuerpo.segmento;
  const modoPrueba = cuerpo.modo_prueba;
  const supabaseUsuario = createClient(supabaseUrl, claveAnonima, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user: llamador },
    error: errorLlamador,
  } = await supabaseUsuario.auth.getUser(tokenJwt);

  if (errorLlamador || !llamador) {
    return responderJson(req, { error: "No autorizado" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, claveServicio, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error: errorPerfil } = await supabaseAdmin
    .from("usuarios")
    .select("rol, tenant_id, es_superadmin")
    .eq("user_id", llamador.id)
    .maybeSingle();
  const perfil = data as PerfilAdministrador | null;

  if (errorPerfil) {
    console.error(
      "[enviar-campana-reactivacion] Error consultando administrador:",
      errorPerfil,
    );
    return responderJson(
      req,
      { error: "No se pudo validar al administrador" },
      500,
    );
  }
  if (perfil?.rol !== "admin") {
    return responderJson(
      req,
      { error: "Acceso restringido a administradores" },
      403,
    );
  }

  const esSuperadmin = perfil.es_superadmin === true;
  if (!esSuperadmin && perfil.tenant_id == null) {
    return responderJson(
      req,
      { error: "El administrador no tiene un tenant asignado" },
      403,
    );
  }

  const hoy = fechaLocalMexico();
  const fechaExpiracion = sumarDiasFecha(hoy, 7);

  if (modoPrueba) {
    if (perfil.tenant_id == null) {
      return responderJson(
        req,
        {
          error:
            "El superadministrador necesita tener un tenant_id asignado para crear el cupón de prueba",
        },
        400,
      );
    }

    const emailPrueba = String(cuerpo.email_prueba).trim().toLowerCase();
    let codigo: string | null = null;

    try {
      codigo = await insertarCuponConReintento(supabaseAdmin, {
        segmento,
        tenantId: perfil.tenant_id,
        fechaExpiracion,
        esPrueba: true,
      });
      const correo = construirCorreo(
        segmento,
        "Cliente de prueba",
        codigo,
        true,
      );
      await enviarConResend({
        apiKey: resendApiKey,
        destinatario: emailPrueba,
        subject: correo.subject,
        html: correo.html,
        text: correo.text,
        idempotencyKey: `reactivacion/prueba/${segmento}/${codigo}`,
      });

      return responderJson(req, {
        enviados: 1,
        fallidos: 0,
        detalle_fallidos: [],
      });
    } catch (error) {
      if (codigo) {
        const { error: errorLimpieza } = await supabaseAdmin
          .from("cupones")
          .delete()
          .eq("tenant_id", perfil.tenant_id)
          .eq("codigo", codigo);
        if (errorLimpieza) {
          console.error(
            "[enviar-campana-reactivacion] No se pudo eliminar el cupón de prueba fallido:",
            errorLimpieza,
          );
        }
      }

      return responderJson(req, {
        enviados: 0,
        fallidos: 1,
        detalle_fallidos: [{
          user_id: null,
          email: emailPrueba,
          etapa: "prueba",
          error: mensajeError(error),
        }],
      });
    }
  }

  const tenantConsulta = esSuperadmin ? null : perfil.tenant_id;
  let clientes: ClienteCampana[];
  try {
    clientes = await obtenerClientes(
      supabaseAdmin,
      segmento,
      tenantConsulta,
    );
  } catch (error) {
    console.error(
      "[enviar-campana-reactivacion] Error consultando segmento:",
      error,
    );
    return responderJson(
      req,
      {
        error: mensajeError(error),
        enviados: 0,
        fallidos: 0,
        detalle_fallidos: [],
      },
      500,
    );
  }

  let enviados = 0;
  let fallidos = 0;
  const detalleFallidos: DetalleFallido[] = [];

  for (const cliente of clientes) {
    let codigo: string | null = null;
    let reservaCreada = false;
    let correoAceptadoPorResend = false;

    try {
      if (!esEmailValido(cliente.email)) {
        throw new Error("El cliente no tiene un email válido");
      }

      codigo = await insertarCuponConReintento(supabaseAdmin, {
        segmento,
        tenantId: cliente.tenant_id,
        fechaExpiracion,
        esPrueba: false,
      });

      const { error: errorReserva } = await supabaseAdmin
        .from("campanas_reactivacion_log")
        .insert({
          user_id: cliente.user_id,
          email: cliente.email.trim().toLowerCase(),
          segmento,
          cupon_codigo: codigo,
          enviado_en: null,
          tenant_id: cliente.tenant_id,
        });

      if (errorReserva) {
        if (errorReserva.code === "23505") {
          const { error: errorCuponSobrante } = await supabaseAdmin
            .from("cupones")
            .delete()
            .eq("tenant_id", cliente.tenant_id)
            .eq("codigo", codigo);
          if (errorCuponSobrante) {
            console.error(
              "[enviar-campana-reactivacion] No se pudo eliminar un cupón de una reserva duplicada:",
              errorCuponSobrante,
            );
          }
          continue;
        }
        throw new Error(
          `No se pudo reservar el envío: ${errorReserva.message}`,
        );
      }

      reservaCreada = true;
      const correo = construirCorreo(
        segmento,
        cliente.nombre,
        codigo,
        false,
      );
      await enviarConResend({
        apiKey: resendApiKey,
        destinatario: cliente.email.trim().toLowerCase(),
        subject: correo.subject,
        html: correo.html,
        text: correo.text,
        idempotencyKey: `reactivacion/${segmento}/${cliente.user_id}`,
      });
      correoAceptadoPorResend = true;

      const { error: errorConfirmacion } = await supabaseAdmin
        .from("campanas_reactivacion_log")
        .update({ enviado_en: new Date().toISOString() })
        .eq("user_id", cliente.user_id)
        .eq("segmento", segmento)
        .is("enviado_en", null);
      if (errorConfirmacion) {
        throw new Error(
          `Resend aceptó el correo, pero no se pudo confirmar el log: ${errorConfirmacion.message}`,
        );
      }

      enviados++;
    } catch (error) {
      fallidos++;
      const detalle: DetalleFallido = {
        user_id: cliente.user_id,
        email: cliente.email,
        etapa: correoAceptadoPorResend
          ? "confirmar_log"
          : reservaCreada
          ? "enviar_correo"
          : codigo
          ? "reservar_envio"
          : "crear_cupon",
        error: mensajeError(error),
      };
      if (correoAceptadoPorResend) {
        detalle.requiere_revision_manual = true;
      }
      detalleFallidos.push(detalle);

      if (!correoAceptadoPorResend) {
        if (reservaCreada) {
          const { error: errorEliminarReserva } = await supabaseAdmin
            .from("campanas_reactivacion_log")
            .delete()
            .eq("user_id", cliente.user_id)
            .eq("segmento", segmento)
            .is("enviado_en", null);
          if (errorEliminarReserva) {
            detalle.error +=
              ` | No se pudo liberar la reserva: ${errorEliminarReserva.message}`;
          }
        }

        if (codigo) {
          const { error: errorEliminarCupon } = await supabaseAdmin
            .from("cupones")
            .delete()
            .eq("tenant_id", cliente.tenant_id)
            .eq("codigo", codigo);
          if (errorEliminarCupon) {
            detalle.error +=
              ` | No se pudo eliminar el cupón: ${errorEliminarCupon.message}`;
          }
        }
      }

      console.error(
        "[enviar-campana-reactivacion] Falló destinatario:",
        {
          user_id: cliente.user_id,
          email: cliente.email,
          error: detalle.error,
        },
      );
    }
  }

  return responderJson(req, {
    enviados,
    fallidos,
    detalle_fallidos: detalleFallidos,
  });
});
