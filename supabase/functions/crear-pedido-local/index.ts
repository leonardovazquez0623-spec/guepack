import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGENES = ["https://guepack.com", "https://www.guepack.com"];
const TAMANIOS = new Set(["sobre", "grande"]);
const METODOS_PAGO = new Set(["efectivo", "transferencia", "tarjeta"]);
const ERROR_COBERTURA =
  "No pudimos verificar la cobertura para esa dirección. Intenta de nuevo o contacta a soporte.";

type Objeto = Record<string, unknown>;
type Punto = { lat: number; lng: number };
type Zona = {
  id: number | string;
  nombre: string;
  coordenadas: unknown;
  poligono?: Punto[];
};
type Rango = {
  km_desde: number | string | null;
  km_hasta: number | string | null;
  precio: number | string | null;
};
type Cupon = {
  id: number | string;
  codigo: string;
  tipo: string;
  descuento: number | string;
  fecha_expiracion: string | null;
  usos_maximos: number | null;
  usos_actuales: number | null;
  usos_por_usuario: number | null;
};

function cors(req: Request) {
  const origen = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENES.includes(origen)
      ? origen
      : ORIGENES[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function responder(req: Request, cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function esObjeto(valor: unknown): valor is Objeto {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

function limpiar(valor: unknown) {
  return typeof valor === "string"
    ? valor.trim().replace(/<[^>]*>/g, "").replace(/\u0000/g, "")
    : "";
}

function requerido(valor: unknown, campo: string, maximo: number) {
  const texto = limpiar(valor);
  if (!texto) throw new Error(`El campo ${campo} es obligatorio`);
  if (texto.length > maximo) {
    throw new Error(`El campo ${campo} no puede exceder ${maximo} caracteres`);
  }
  return texto;
}

function opcional(
  valor: unknown,
  campo: string,
  maximo: number,
): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const texto = limpiar(valor);
  if (texto.length > maximo) {
    throw new Error(`El campo ${campo} no puede exceder ${maximo} caracteres`);
  }
  return texto || null;
}

function numero(valor: unknown, campo: string) {
  const resultado = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(resultado)) {
    throw new Error(`El campo ${campo} no es válido`);
  }
  return resultado;
}

const dinero = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 100) / 100;
const kilometros = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 10) / 10;

function latitud(valor: unknown, campo: string) {
  const resultado = numero(valor, campo);
  if (resultado < -90 || resultado > 90) {
    throw new Error(`El campo ${campo} está fuera de rango`);
  }
  return resultado;
}

function longitud(valor: unknown, campo: string) {
  const resultado = numero(valor, campo);
  if (resultado < -180 || resultado > 180) {
    throw new Error(`El campo ${campo} está fuera de rango`);
  }
  return resultado;
}

function uuid(valor: unknown, campo: string) {
  const texto = requerido(valor, campo, 100);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(texto)
  ) {
    throw new Error(`El campo ${campo} no es una clave válida`);
  }
  return texto;
}

function hoyMexico() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fechaValida(valor: unknown) {
  const fecha = requerido(valor, "fecha", 10);
  const interpretada = new Date(`${fecha}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
    Number.isNaN(interpretada.getTime()) ||
    interpretada.toISOString().slice(0, 10) !== fecha
  ) {
    throw new Error("La fecha no es válida");
  }
  if (fecha < hoyMexico()) {
    throw new Error("La fecha del pedido no puede estar en el pasado");
  }
  return fecha;
}

function nombreValido(valor: unknown, campo: string) {
  const nombre = requerido(valor, campo, 100);
  if (!/^[\p{L}\s.'-]+$/u.test(nombre)) {
    throw new Error(`El campo ${campo} contiene caracteres no permitidos`);
  }
  return nombre;
}

function alcanceValido(cuerpo: Objeto) {
  if (Array.isArray(cuerpo.paradas) && cuerpo.paradas.length > 0) {
    throw new Error(
      "Los pedidos con paradas adicionales todavía no están disponibles en este flujo",
    );
  }
  const activo = (valor: unknown) =>
    valor === true || (typeof valor === "string" && valor.trim() !== "");
  if (activo(cuerpo.modo_paqueteria)) {
    throw new Error(
      "Los pedidos de paquetería todavía no están disponibles en este flujo",
    );
  }
  if (activo(cuerpo.modo_mercadolibre)) {
    throw new Error(
      "Los pedidos de Mercado Libre todavía no están disponibles en este flujo",
    );
  }
}

function comprobanteValido(valor: unknown, metodo: string) {
  const ruta = opcional(valor, "comprobante_pago", 500);
  if (metodo === "transferencia" && !ruta) {
    throw new Error("Debes subir el comprobante de la transferencia");
  }
  if (
    ruta &&
    (ruta.includes("..") || ruta.startsWith("/") ||
      !ruta.startsWith("comprobantes/"))
  ) {
    throw new Error("La ruta del comprobante no es válida");
  }
  return ruta;
}

function poligono(valor: unknown): Punto[] | null {
  if (!Array.isArray(valor) || valor.length < 3) return null;
  const puntos: Punto[] = [];
  for (const elemento of valor) {
    if (!esObjeto(elemento)) return null;
    const lat = Number(elemento.lat);
    const lng = Number(elemento.lng);
    if (
      !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 ||
      lng < -180 || lng > 180
    ) return null;
    puntos.push({ lat, lng });
  }
  return puntos;
}

function puntoEnPoligono(lat: number, lng: number, puntos: Punto[]) {
  let dentro = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const xi = puntos[i].lng, yi = puntos[i].lat;
    const xj = puntos[j].lng, yj = puntos[j].lat;
    if (
      ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    ) dentro = !dentro;
  }
  return dentro;
}

function haversine(origen: Punto, destino: Punto) {
  const rad = (grados: number) => grados * Math.PI / 180;
  const diferenciaLat = rad(destino.lat - origen.lat);
  const diferenciaLng = rad(destino.lng - origen.lng);
  const a = Math.sin(diferenciaLat / 2) ** 2 +
    Math.cos(rad(origen.lat)) * Math.cos(rad(destino.lat)) *
      Math.sin(diferenciaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validarDistancia(km: number, lineaRecta: number) {
  if (km < 0 || km > 500) {
    throw new Error(
      "La distancia cotizada no es válida. Vuelve a cotizar el envío.",
    );
  }
  if (lineaRecta < 0.05) {
    if (km > 0.5) {
      throw new Error("La distancia cambió. Vuelve a cotizar el envío.");
    }
    return;
  }
  if (km < lineaRecta * 0.9 || km > lineaRecta * 2.5) {
    throw new Error("La distancia cambió. Vuelve a cotizar el envío.");
  }
}

function porcentajeVip(nivel: unknown) {
  return ({ bronce: 0.02, plata: 0.03, oro: 0.05 } as Record<string, number>)[
    String(nivel || "").toLowerCase()
  ] || 0;
}

function estadoInicial(metodo: string) {
  if (metodo === "transferencia") return "Pendiente verificación de pago";
  if (metodo === "tarjeta") return "Pendiente pago MP";
  return "Pendiente";
}

function errorRpc(mensaje: string) {
  if (mensaje.includes("CUPON_AGOTADO")) {
    return [409, "Este cupón ya no tiene usos disponibles"] as const;
  }
  if (mensaje.includes("CUPON_EXPIRADO")) {
    return [409, "Este cupón ha expirado"] as const;
  }
  if (mensaje.includes("LIMITE_CUPON_USUARIO")) {
    return [409, "Ya alcanzaste el límite de uso de este cupón"] as const;
  }
  if (
    mensaje.includes("CUPON_NO_DISPONIBLE") ||
    mensaje.includes("CONFIGURACION_CUPON_INVALIDA")
  ) {
    return [409, "El cupón ya no está disponible"] as const;
  }
  if (
    mensaje.includes("CUPON_CAMBIO_REQUIERE_RECOTIZAR") ||
    mensaje.includes("CARGO_CANCELACION_CAMBIO")
  ) {
    return [
      409,
      "El precio cambió mientras creábamos el pedido. Vuelve a cotizar.",
    ] as const;
  }
  if (mensaje.includes("FLUJO_CORPORATIVO_NO_PERMITIDO")) {
    return [
      409,
      "Este pedido corresponde al flujo corporativo y debe volver a cotizarse.",
    ] as const;
  }
  return [500, "No pudimos crear el pedido. Intenta nuevamente."] as const;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors(req) });
  }
  if (req.method !== "POST") {
    return responder(req, { error: "Método no permitido" }, 405);
  }

  const autorizacion = req.headers.get("Authorization");
  if (!autorizacion) return responder(req, { error: "No autorizado" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const servicio = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !anon || !servicio) {
    console.error(
      "[crear-pedido-local] Faltan variables de entorno requeridas",
    );
    return responder(req, {
      error: "El servicio no está configurado correctamente",
    }, 500);
  }

  const token = autorizacion.replace(/^Bearer\s+/i, "");
  const autenticacion = createClient(url, anon);
  const { data: { user }, error: errorUsuario } = await autenticacion.auth
    .getUser(token);
  if (errorUsuario || !user) {
    return responder(req, { error: "La sesión no es válida" }, 401);
  }

  let cuerpo: Objeto;
  try {
    const recibido = await req.json();
    if (!esObjeto(recibido)) throw new Error();
    cuerpo = recibido;
  } catch {
    return responder(req, {
      error: "El contenido de la solicitud no es válido",
    }, 400);
  }

  try {
    alcanceValido(cuerpo);
    const nombre = nombreValido(cuerpo.nombre, "nombre");
    const nombreRemitente = opcional(
      cuerpo.nombre_remitente,
      "nombre_remitente",
      100,
    );
    if (nombreRemitente && !/^[\p{L}\s.'-]+$/u.test(nombreRemitente)) {
      throw new Error(
        "El nombre del remitente contiene caracteres no permitidos",
      );
    }
    const whatsapp = requerido(cuerpo.whatsapp, "whatsapp", 10);
    if (!/^\d{10}$/.test(whatsapp)) {
      throw new Error("El WhatsApp debe tener exactamente 10 dígitos");
    }
    const direccionRecoleccion = requerido(
      cuerpo.direccion_recoleccion,
      "direccion_recoleccion",
      300,
    );
    const direccionEntrega = requerido(
      cuerpo.direccion_entrega,
      "direccion_entrega",
      300,
    );
    const instrucciones = opcional(cuerpo.instrucciones, "instrucciones", 500);
    const fecha = fechaValida(cuerpo.fecha);
    const tamanio = requerido(cuerpo.tamanio, "tamanio", 20).toLowerCase();
    if (!TAMANIOS.has(tamanio)) {
      throw new Error("El tamaño de paquete no es válido");
    }
    const metodo = requerido(cuerpo.metodo_pago, "metodo_pago", 30)
      .toLowerCase();
    if (!METODOS_PAGO.has(metodo)) {
      throw new Error("El método de pago no es válido");
    }
    const comprobante = comprobanteValido(cuerpo.comprobante_pago, metodo);
    const claveIdempotencia = uuid(cuerpo.idempotency_key, "idempotency_key");
    const latRecoleccion = latitud(cuerpo.lat_recoleccion, "lat_recoleccion");
    const lngRecoleccion = longitud(cuerpo.lng_recoleccion, "lng_recoleccion");
    const latEntrega = latitud(cuerpo.lat_entrega, "lat_entrega");
    const lngEntrega = longitud(cuerpo.lng_entrega, "lng_entrega");
    const km = kilometros(numero(cuerpo.km_recorridos, "km_recorridos"));
    const codigoCupon =
      opcional(cuerpo.cupon_codigo, "cupon_codigo", 50)?.toUpperCase() ?? null;

    validarDistancia(
      km,
      haversine(
        { lat: latRecoleccion, lng: lngRecoleccion },
        { lat: latEntrega, lng: lngEntrega },
      ),
    );

    const admin = createClient(url, servicio, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: perfil, error: falloPerfil } = await admin.from("usuarios")
      .select(
        "user_id, tenant_id, empresa_codigo, nivel_vip, cargo_cancelacion",
      )
      .eq("user_id", user.id).maybeSingle();
    if (falloPerfil) throw new Error("No pudimos verificar tu perfil");
    if (!perfil || perfil.tenant_id === null) {
      return responder(req, {
        error: "No pudimos determinar la cuenta del pedido",
      }, 403);
    }
    if (
      (typeof perfil.empresa_codigo === "string" &&
        perfil.empresa_codigo.trim()) ||
      (typeof user.user_metadata?.empresa_codigo === "string" &&
        user.user_metadata.empresa_codigo.trim())
    ) {
      return responder(req, {
        error:
          "Este pedido pertenece al flujo corporativo. Vuelve a cotizarlo desde tu cuenta de empresa.",
      }, 409);
    }
    const tenant = perfil.tenant_id;

    const { data: zonas, error: falloZonas } = await admin.from(
      "zonas_cobertura",
    )
      .select("id, nombre, coordenadas").eq("tenant_id", tenant).eq(
        "activa",
        true,
      );
    if (falloZonas) throw new Error(ERROR_COBERTURA);
    const validas = ((zonas || []) as Zona[]).map((z) => ({
      ...z,
      poligono: poligono(z.coordenadas),
    }))
      .filter((z): z is Zona & { poligono: Punto[] } => Boolean(z.poligono));
    const limite = validas.find((z) =>
      z.nombre.trim().toUpperCase() === "LIMITE CIUDAD"
    );
    const operativas = validas.filter((z) =>
      z.nombre.trim().toUpperCase() !== "LIMITE CIUDAD"
    );
    if (
      !operativas.length ||
      (limite && !puntoEnPoligono(latEntrega, lngEntrega, limite.poligono))
    ) {
      return responder(req, { error: ERROR_COBERTURA }, 422);
    }
    const zona = operativas.find((z) =>
      puntoEnPoligono(latEntrega, lngEntrega, z.poligono)
    );
    if (!zona) return responder(req, { error: ERROR_COBERTURA }, 422);

    const [consultaPrecios, consultaRangos] = await Promise.all([
      admin.from("precios_generales")
        .select(
          "tarifa_base, km_minimo, precio_km_extra, iva, cargo_paquete_grande",
        )
        .eq("tenant_id", tenant).maybeSingle(),
      admin.from("rangos_precio_general").select("km_desde, km_hasta, precio")
        .eq("tenant_id", tenant).order("km_desde"),
    ]);
    if (
      consultaPrecios.error || consultaRangos.error || !consultaPrecios.data ||
      !consultaRangos.data?.length
    ) {
      return responder(req, {
        error: "No hay una tarifa general configurada para este servicio",
      }, 422);
    }

    const precios = consultaPrecios.data;
    const precioKmExtra = Number(precios.precio_km_extra);
    const iva = Number(precios.iva);
    const cargoGrandeConfigurado = Number(precios.cargo_paquete_grande);
    if (
      ![precioKmExtra, iva, cargoGrandeConfigurado].every(Number.isFinite) ||
      precioKmExtra < 0 || iva < 0 || iva > 1 || cargoGrandeConfigurado < 0
    ) {
      throw new Error("La tarifa vigente no está configurada correctamente");
    }

    const rangos = (consultaRangos.data as Rango[]).sort((a, b) =>
      Number(a.km_desde || 0) - Number(b.km_desde || 0)
    );
    let rango = rangos.find((r) =>
      Number(r.km_desde || 0) <= km &&
      (r.km_hasta === null || km <= Number(r.km_hasta))
    );
    if (!rango) rango = rangos[rangos.length - 1];
    const desde = Number(rango.km_desde || 0);
    const hasta = rango.km_hasta === null ? null : Number(rango.km_hasta);
    let precioBase = Number(rango.precio);
    if (
      ![desde, precioBase].every(Number.isFinite) ||
      (hasta !== null && !Number.isFinite(hasta)) || precioBase < 0
    ) {
      throw new Error("La tarifa vigente contiene un rango inválido");
    }
    if (hasta === null && km > desde) {
      precioBase += kilometros(km - desde) * precioKmExtra;
    }

    let subtotal = precioBase +
      (tamanio === "grande" ? cargoGrandeConfigurado : 0);
    subtotal = dinero(
      subtotal - dinero(subtotal * porcentajeVip(perfil.nivel_vip)),
    );
    const cargoCancelacion = Math.max(
      0,
      dinero(Number(perfil.cargo_cancelacion) || 0),
    );
    const totalAntesCupon = dinero(
      subtotal + dinero(subtotal * iva) + cargoCancelacion,
    );

    let descuentoCupon = 0;
    let cupon: Cupon | null = null;
    if (codigoCupon) {
      const { data, error } = await admin.from("cupones")
        .select(
          "id, codigo, tipo, descuento, fecha_expiracion, usos_maximos, usos_actuales, usos_por_usuario",
        )
        .eq("tenant_id", tenant).eq("codigo", codigoCupon).maybeSingle();
      if (error) throw new Error("No pudimos validar el cupón");
      if (!data) {
        return responder(req, { error: "El cupón no está disponible" }, 409);
      }
      cupon = data as Cupon;
      if (cupon.fecha_expiracion && cupon.fecha_expiracion < hoyMexico()) {
        return responder(req, { error: "Este cupón ha expirado" }, 409);
      }
      if (
        cupon.usos_maximos !== null &&
        Number(cupon.usos_actuales || 0) >= cupon.usos_maximos
      ) {
        return responder(req, {
          error: "Este cupón ya no tiene usos disponibles",
        }, 409);
      }
      if (cupon.usos_por_usuario !== null) {
        const { data: uso, error: falloUso } = await admin.from("cupones_usos")
          .select("usos")
          .eq("cupon_id", cupon.id).eq("user_id", user.id).maybeSingle();
        if (falloUso) throw new Error("No pudimos validar el cupón");
        if (Number(uso?.usos || 0) >= cupon.usos_por_usuario) {
          return responder(req, {
            error: "Ya alcanzaste el límite de uso de este cupón",
          }, 409);
        }
      }
      const valor = Number(cupon.descuento);
      if (!Number.isFinite(valor) || valor < 0) {
        throw new Error("El cupón no está configurado correctamente");
      }
      if (cupon.tipo === "porcentaje") {
        if (valor > 100) {
          throw new Error("El cupón no está configurado correctamente");
        }
        descuentoCupon = dinero(totalAntesCupon * valor / 100);
      } else if (cupon.tipo === "fijo" || cupon.tipo === "monto") {
        descuentoCupon = Math.min(totalAntesCupon, valor);
      } else {
        throw new Error("El cupón no está configurado correctamente");
      }
    }

    const precioFinal = Math.max(0, dinero(totalAntesCupon - descuentoCupon));
    const tokenRastreo = crypto.randomUUID();
    const { data: resultadoRpc, error: falloRpc } = await admin.rpc(
      "crear_pedido_general_atomico",
      {
        p_user_id: user.id,
        p_tenant_id: tenant,
        p_idempotency_key: claveIdempotencia,
        p_nombre: nombre,
        p_nombre_remitente: nombreRemitente,
        p_whatsapp: whatsapp,
        p_direccion_recoleccion: direccionRecoleccion,
        p_direccion_entrega: direccionEntrega,
        p_fecha: fecha,
        p_tamanio: tamanio,
        p_zona: `${zona.nombre} · ${km} km`,
        p_precio_final: precioFinal,
        p_total_antes_cupon: totalAntesCupon,
        p_estado: estadoInicial(metodo),
        p_instrucciones: instrucciones,
        p_metodo_pago: metodo,
        p_comprobante_pago: comprobante,
        p_token_rastreo: tokenRastreo,
        p_km_recorridos: km,
        p_lat_recoleccion: latRecoleccion,
        p_lng_recoleccion: lngRecoleccion,
        p_lat_entrega: latEntrega,
        p_lng_entrega: lngEntrega,
        p_cargo_cancelacion: cargoCancelacion,
        p_cupon_codigo: cupon?.codigo ?? null,
      },
    );
    if (falloRpc) {
      console.error(
        "[crear-pedido-local] La creación atómica falló:",
        falloRpc.message,
      );
      const [estado, mensaje] = errorRpc(falloRpc.message);
      return responder(req, { error: mensaje }, estado);
    }
    const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : null;
    if (!resultado || !esObjeto(resultado.pedido)) {
      throw new Error(
        "El pedido fue procesado, pero no pudimos recuperar el resultado",
      );
    }
    return responder(req, {
      data: [resultado.pedido],
      es_recuperacion_de_duplicado: resultado.es_recuperacion === true,
    });
  } catch (error) {
    const mensaje = error instanceof Error
      ? error.message
      : "La solicitud no es válida";
    return responder(req, { error: mensaje }, 400);
  }
});
