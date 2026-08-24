import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { esOrigenPermitido } from "../_shared/cors.ts";

const LIMITE_ACTIVACION = 100;
const LIMITE_ASIGNACIONES = 100;

type Incidencia = {
  pedido_id: number;
  tenant_id: number;
  motivo:
    | "CONFIGURACION_FALTANTE"
    | "HORARIO_APERTURA_FALTANTE"
    | "ZONA_HORARIA_FALTANTE";
  debe_enviar_alerta: boolean;
};

type ResultadoActivacion = {
  success: boolean;
  evaluados: number;
  activados: number;
  configuraciones_invalidas: number;
  fechas_invalidas: number;
  incidencias: Incidencia[];
};

type TrabajoAsignacion = {
  outbox_id: number;
  pedido_id: number;
  tenant_id: number;
  ronda: number;
  intentos: number;
};

function encabezadosCors(req: Request): Record<string, string> {
  const origen = req.headers.get("Origin") ?? "";
  if (!esOrigenPermitido(origen)) return {};
  return {
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Allow-Headers":
      "authorization, content-type, x-client-info, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function responder(req: Request, contenido: unknown, estado = 200): Response {
  return new Response(JSON.stringify(contenido), {
    status: estado,
    headers: {
      ...encabezadosCors(req),
      "Content-Type": "application/json",
    },
  });
}

function mensajeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function numeroNoNegativo(valor: unknown): number {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : 0;
}

function arreglo<T>(valor: unknown): T[] {
  return Array.isArray(valor) ? valor as T[] : [];
}

async function resolverTrabajo(
  supabaseAdmin: ReturnType<typeof createClient>,
  trabajo: TrabajoAsignacion,
  reclamadoPor: string,
  exitosa: boolean,
  error: string | null,
): Promise<boolean> {
  const { data, error: errorResolucion } = await supabaseAdmin.rpc(
    "resolver_asignacion_programada",
    {
      p_outbox_id: trabajo.outbox_id,
      p_reclamado_por: reclamadoPor,
      p_exitosa: exitosa,
      p_error: error,
      p_ahora: new Date().toISOString(),
    },
  );

  if (errorResolucion) {
    console.error(
      "[activar-pedidos-programados] No se pudo resolver el outbox:",
      {
        outbox_id: trabajo.outbox_id,
        pedido_id: trabajo.pedido_id,
        exitosa,
        error: errorResolucion.message,
      },
    );
    return false;
  }

  return data === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: encabezadosCors(req) });
  }

  if (req.method !== "POST") {
    return responder(req, { error: "Método no permitido" }, 405);
  }

  const clavesServicio = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("SERVICE_ROLE_KEY"),
  ].filter((clave): clave is string => Boolean(clave));
  const claveServicio = clavesServicio[0];
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!claveServicio || !supabaseUrl) {
    console.error(
      "[activar-pedidos-programados] Faltan variables de Supabase",
    );
    return responder(req, { error: "Configuración interna incompleta" }, 500);
  }

  const tokenJwt = (req.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "");
  if (!tokenJwt || !clavesServicio.includes(tokenJwt)) {
    return responder(req, { error: "No autorizado" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, claveServicio, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: datosActivacion, error: errorActivacion } =
      await supabaseAdmin.rpc("activar_pedidos_programados_lote", {
        p_limite: LIMITE_ACTIVACION,
        p_ahora: new Date().toISOString(),
      });

    if (errorActivacion) {
      console.error(
        "[activar-pedidos-programados] Falló la RPC de activación:",
        errorActivacion.message,
      );
      return responder(req, {
        success: false,
        error: "No fue posible evaluar los pedidos programados",
      }, 500);
    }

    const resultado = (datosActivacion || {}) as ResultadoActivacion;
    const incidencias = arreglo<Incidencia>(resultado.incidencias);

    for (const incidencia of incidencias) {
      if (incidencia.debe_enviar_alerta !== true) continue;

      try {
        const respuestaAlerta = await fetch(
          `${supabaseUrl}/functions/v1/enviar-push`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${claveServicio}`,
            },
            body: JSON.stringify({
              tipo_notificacion: "horario_apertura_faltante_admin",
              pedido_id: incidencia.pedido_id,
              motivo: incidencia.motivo,
            }),
          },
        );

        if (!respuestaAlerta.ok) {
          const detalle = await respuestaAlerta.text().catch(() => "");
          console.error(
            "[activar-pedidos-programados] No se pudo alertar al admin:",
            {
              pedido_id: incidencia.pedido_id,
              tenant_id: incidencia.tenant_id,
              motivo: incidencia.motivo,
              status: respuestaAlerta.status,
              detalle,
            },
          );
        }
      } catch (errorAlerta) {
        console.error(
          "[activar-pedidos-programados] Error llamando enviar-push:",
          {
            pedido_id: incidencia.pedido_id,
            tenant_id: incidencia.tenant_id,
            motivo: incidencia.motivo,
            error: mensajeError(errorAlerta),
          },
        );
      }
    }

    const reclamadoPor = crypto.randomUUID();
    const { data: datosTrabajos, error: errorReclamacion } = await supabaseAdmin
      .rpc("reclamar_asignaciones_programadas", {
        p_reclamado_por: reclamadoPor,
        p_limite: LIMITE_ASIGNACIONES,
        p_ahora: new Date().toISOString(),
      });

    if (errorReclamacion) {
      console.error(
        "[activar-pedidos-programados] No se pudo reclamar el outbox:",
        errorReclamacion.message,
      );
      return responder(req, {
        success: false,
        evaluados: numeroNoNegativo(resultado.evaluados),
        activados: numeroNoNegativo(resultado.activados),
        asignaciones_procesadas: 0,
        asignaciones_pendientes: 0,
        configuraciones_invalidas: numeroNoNegativo(
          resultado.configuraciones_invalidas,
        ),
        fechas_invalidas: numeroNoNegativo(resultado.fechas_invalidas),
        error:
          "Los pedidos fueron evaluados, pero no se pudo procesar el outbox",
      }, 500);
    }

    const trabajos = arreglo<TrabajoAsignacion>(datosTrabajos);
    let asignacionesProcesadas = 0;
    let asignacionesFallidas = 0;

    for (const trabajo of trabajos) {
      try {
        const respuestaAsignacion = await fetch(
          `${supabaseUrl}/functions/v1/procesar-asignacion`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${claveServicio}`,
            },
            body: JSON.stringify({
              pedido_id: trabajo.pedido_id,
              ronda: trabajo.ronda,
            }),
          },
        );

        if (!respuestaAsignacion.ok) {
          const detalle = await respuestaAsignacion.text().catch(() => "");
          const errorAsignacion = detalle ||
            `procesar-asignacion respondió ${respuestaAsignacion.status}`;
          await resolverTrabajo(
            supabaseAdmin,
            trabajo,
            reclamadoPor,
            false,
            errorAsignacion,
          );
          asignacionesFallidas += 1;
          console.error(
            "[activar-pedidos-programados] Falló procesar-asignacion:",
            {
              outbox_id: trabajo.outbox_id,
              pedido_id: trabajo.pedido_id,
              ronda: trabajo.ronda,
              status: respuestaAsignacion.status,
              detalle,
            },
          );
          continue;
        }

        const resuelta = await resolverTrabajo(
          supabaseAdmin,
          trabajo,
          reclamadoPor,
          true,
          null,
        );
        if (!resuelta) {
          asignacionesFallidas += 1;
          console.error(
            "[activar-pedidos-programados] No se pudo cerrar el outbox:",
            {
              outbox_id: trabajo.outbox_id,
              pedido_id: trabajo.pedido_id,
            },
          );
          continue;
        }

        asignacionesProcesadas += 1;
      } catch (errorAsignacion) {
        const detalle = mensajeError(errorAsignacion);
        await resolverTrabajo(
          supabaseAdmin,
          trabajo,
          reclamadoPor,
          false,
          detalle,
        );
        asignacionesFallidas += 1;
        console.error(
          "[activar-pedidos-programados] Error procesando asignación:",
          {
            outbox_id: trabajo.outbox_id,
            pedido_id: trabajo.pedido_id,
            ronda: trabajo.ronda,
            error: detalle,
          },
        );
      }
    }

    const { count: pendientesTotales, error: errorConteoPendientes } =
      await supabaseAdmin
        .from("pedidos_programados_outbox")
        .select("id", { count: "exact", head: true })
        .in("estado", ["pendiente", "procesando"]);

    if (errorConteoPendientes) {
      console.error(
        "[activar-pedidos-programados] No se pudo contar el outbox pendiente:",
        errorConteoPendientes.message,
      );
    }

    const asignacionesPendientes = typeof pendientesTotales === "number"
      ? pendientesTotales
      : asignacionesFallidas;

    return responder(req, {
      success: resultado.success === true,
      evaluados: numeroNoNegativo(resultado.evaluados),
      activados: numeroNoNegativo(resultado.activados),
      asignaciones_procesadas: asignacionesProcesadas,
      asignaciones_pendientes: asignacionesPendientes,
      configuraciones_invalidas: numeroNoNegativo(
        resultado.configuraciones_invalidas,
      ),
      fechas_invalidas: numeroNoNegativo(resultado.fechas_invalidas),
    });
  } catch (error) {
    console.error(
      "[activar-pedidos-programados] Error no controlado:",
      mensajeError(error),
    );
    return responder(req, {
      success: false,
      error: "No fue posible activar los pedidos programados",
    }, 500);
  }
});
