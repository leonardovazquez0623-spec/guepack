import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGENES_PERMITIDOS = new Set([
  "https://guepack.com",
  "https://www.guepack.com",
]);

function obtenerEncabezadosCors(req: Request): Record<string, string> {
  const origen = req.headers.get("Origin") ?? "";
  if (!ORIGENES_PERMITIDOS.has(origen)) return {};
  return {
    "Access-Control-Allow-Origin": origen,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const origen = req.headers.get("Origin") ?? "";
  const encabezadosCors = obtenerEncabezadosCors(req);

  function responder(cuerpo: unknown, estado = 200) {
    return new Response(JSON.stringify(cuerpo), {
      status: estado,
      headers: {
        ...encabezadosCors,
        "Content-Type": "application/json",
      },
    });
  }

  if (origen && !ORIGENES_PERMITIDOS.has(origen)) {
    return responder({ error: "Origen no permitido" }, 403);
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: encabezadosCors });
  }

  if (req.method !== "POST") {
    return responder({ error: "Método no permitido" }, 405);
  }

  try {
    const cuerpo = await req.json();
    const token = typeof cuerpo?.token === "string" ? cuerpo.token.trim() : "";

    if (!token) {
      return responder({ error: "Falta el token de rastreo" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: pedido, error } = await supabaseAdmin
      .from("pedidos")
      .select("id, nombre, estado, repartidor, zona, tamanio, created_at, token_rastreo")
      .eq("token_rastreo", token)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[rastreo-publico] Error al consultar el pedido:", error.message);
      return responder({ error: "No se pudo consultar el pedido" }, 500);
    }

    if (!pedido) {
      return responder({ error: "Pedido no encontrado" }, 404);
    }

    return responder({
      id: pedido.id,
      folio: `GK-${pedido.id}`,
      estado: pedido.estado,
      zona: pedido.zona,
      tamanio: pedido.tamanio,
      repartidor: pedido.repartidor,
      created_at: pedido.created_at,
    });
  } catch (error: any) {
    console.error("[rastreo-publico] Error inesperado:", error.message);
    return responder({ error: "Error interno al consultar el rastreo" }, 500);
  }
});
