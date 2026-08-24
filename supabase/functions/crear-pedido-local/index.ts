import "jsr:@supabase/functions-js@^2/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { origenPermitidoOFallback } from "../_shared/cors.ts";

const TAMANIOS = new Set(["sobre", "grande"]);
const MODOS_PAQUETERIA = new Set(["paqueteria", "mercado_libre"]);
const METODOS_PAGO = new Map<string, string>([
  ["efectivo", "efectivo"],
  ["transferencia", "transferencia"],
  ["tarjeta", "tarjeta"],
  ["crédito", "Crédito"],
]);
const ERROR_COBERTURA =
  "No pudimos verificar la cobertura para esa dirección. Intenta de nuevo o contacta a soporte.";

type Objeto = Record<string, unknown>;
type Punto = { lat: number; lng: number };
type Zona = {
  id: number | string;
  nombre: string;
  coordenadas: unknown;
  precio_sobre?: number | string | null;
  precio_grande?: number | string | null;
  precio_por_km?: number | string | null;
  poligono?: Punto[];
};
type ParadaSolicitud = {
  orden: number;
  direccion: string;
  instrucciones: string | null;
  lat: number;
  lng: number;
};
type Rango = {
  km_desde: number | string | null;
  km_hasta: number | string | null;
  precio: number | string | null;
};
type RangoPaqueteria = {
  tipo: string | null;
  cantidad_desde: number | string | null;
  cantidad_hasta: number | string | null;
  precio: number | string | null;
};
type RangoPaqueteriaNormalizado = {
  tipo: "Bolsa" | "Caja";
  desde: number;
  hasta: number | null;
  precio: number;
};
type EmpresaCorporativa = {
  id: number | string;
  codigo: string;
  activa: boolean | null;
  tipo_tarifa: string | null;
  tarifa_diaria: number | string | null;
  tarifa_km: number | string | null;
  tarifa_minima: number | string | null;
  km_minimo: number | string | null;
  tarifa_base_extra: number | string | null;
  iva: number | string | null;
  cargo_paquete_grande: number | string | null;
  permite_paqueterias: boolean | null;
  permite_mercado_libre: boolean | null;
  tarifa_receta: number | string | null;
  km_incluidos_receta: number | string | null;
  tarifa_km_receta: number | string | null;
  lat_farmacia: number | string | null;
  lng_farmacia: number | string | null;
};
type PedidoCoberturaDiaria = {
  fecha: string;
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
    "Access-Control-Allow-Origin": origenPermitidoOFallback(origen),
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
  if (valor === null || valor === undefined || valor === "") {
    throw new Error(`El campo ${campo} es obligatorio`);
  }

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

function cantidadPaqueteria(valor: unknown, campo: string) {
  const cantidad = numero(valor, campo);
  if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > 5) {
    throw new Error(`${campo} debe ser un número entero entre 0 y 5`);
  }
  return cantidad;
}

function modoPaqueteria(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return null;
  const modo = requerido(valor, "modo", 30).toLowerCase();
  if (!MODOS_PAQUETERIA.has(modo)) {
    throw new Error("El modo de paquetería no es válido");
  }
  return modo as "paqueteria" | "mercado_libre";
}

/*
 * Replica la precedencia de crear_pedido_paqueteria_atomico:
 * 1. menor cantidad_desde;
 * 2. menor cantidad_hasta, dejando rangos abiertos al final;
 * 3. menor precio como desempate final.
 */
function seleccionarRangoPaqueteria(
  rangos: RangoPaqueteria[],
  tipo: "Bolsa" | "Caja",
  cantidad: number,
): RangoPaqueteriaNormalizado | null {
  if (cantidad <= 0) return null;

  const candidatos = rangos
    .map((rango): RangoPaqueteriaNormalizado | null => {
      const desde = Number(rango.cantidad_desde);
      const hasta = rango.cantidad_hasta === null
        ? null
        : Number(rango.cantidad_hasta);
      const precio = Number(rango.precio);
      if (
        rango.tipo !== tipo ||
        !Number.isFinite(desde) ||
        !Number.isFinite(precio) ||
        desde < 0 ||
        precio < 0 ||
        (hasta !== null && (!Number.isFinite(hasta) || hasta < desde))
      ) {
        return null;
      }
      return { tipo, desde, hasta, precio };
    })
    .filter(
      (rango): rango is RangoPaqueteriaNormalizado =>
        rango !== null &&
        cantidad >= rango.desde &&
        (rango.hasta === null || cantidad <= rango.hasta),
    )
    .sort((a, b) =>
      a.desde - b.desde ||
      (a.hasta ?? Number.POSITIVE_INFINITY) -
        (b.hasta ?? Number.POSITIVE_INFINITY) ||
      a.precio - b.precio
    );

  return candidatos[0] ?? null;
}

function validarParadas(valor: unknown): ParadaSolicitud[] | null {
  if (valor === null || valor === undefined) return null;
  if (!Array.isArray(valor)) {
    throw new Error("Las paradas no tienen un formato válido");
  }
  if (valor.length < 2) {
    throw new Error("Un pedido multiparada debe incluir al menos 2 paradas");
  }
  if (valor.length > 8) {
    throw new Error("Un pedido multiparada admite como máximo 8 paradas");
  }

  return valor.map((elemento, indice) => {
    if (!esObjeto(elemento)) {
      throw new Error(`La parada ${indice + 1} no tiene un formato válido`);
    }
    const orden = numero(elemento.orden, `paradas[${indice}].orden`);
    if (!Number.isInteger(orden) || orden !== indice + 1) {
      throw new Error("Las paradas deben tener órdenes consecutivos desde 1");
    }
    return {
      orden,
      direccion: requerido(
        elemento.direccion,
        `paradas[${indice}].direccion`,
        300,
      ),
      instrucciones: opcional(
        elemento.instrucciones,
        `paradas[${indice}].instrucciones`,
        500,
      ),
      lat: latitud(elemento.lat, `paradas[${indice}].lat`),
      lng: longitud(elemento.lng, `paradas[${indice}].lng`),
    };
  });
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

function hoyMexico(fecha = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fecha);
}

function hoyEnZonaHoraria(zonaHoraria: string, fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(fecha);
  const valores = Object.fromEntries(
    partes.map((parte) => [parte.type, parte.value]),
  );
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function horaEnZonaHoraria(zonaHoraria: string, fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zonaHoraria,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const valores = Object.fromEntries(
    partes.map((parte) => [parte.type, parte.value]),
  );
  return `${valores.hour}:${valores.minute}`;
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
  const activo = (valor: unknown) =>
    valor === true || (typeof valor === "string" && valor.trim() !== "");
  if (activo(cuerpo.modo_paqueteria)) {
    throw new Error(
      'Utiliza modo: "paqueteria" para este tipo de pedido',
    );
  }
  if (activo(cuerpo.modo_mercadolibre)) {
    throw new Error(
      'Utiliza modo: "mercado_libre" para este tipo de pedido',
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

function numeroConfigurado(
  valor: unknown,
  campo: string,
  opciones: { maximo?: number } = {},
) {
  if (
    valor === null ||
    valor === undefined ||
    (typeof valor === "string" && valor.trim() === "")
  ) {
    throw new Error(`La configuración corporativa no tiene ${campo}`);
  }
  const resultado = Number(valor);
  if (
    !Number.isFinite(resultado) ||
    resultado < 0 ||
    (opciones.maximo !== undefined && resultado > opciones.maximo)
  ) {
    throw new Error(
      `La configuración corporativa de ${campo} no es válida`,
    );
  }
  return resultado;
}

function calcularPrecioCorporativo(
  empresa: EmpresaCorporativa,
  rangosRecibidos: Rango[],
  km: number,
  tamanio: string,
  cargoGrandeGeneral: unknown,
  cargoCancelacion: number,
) {
  // Fase 2 es estricta incluso cuando la empresa utiliza rangos.
  const tarifaKm = numeroConfigurado(empresa.tarifa_km, "tarifa_km");
  const tarifaMinima = numeroConfigurado(
    empresa.tarifa_minima,
    "tarifa_minima",
  );
  const kmMinimo = numeroConfigurado(empresa.km_minimo, "km_minimo");
  const tarifaBaseExtra = numeroConfigurado(
    empresa.tarifa_base_extra,
    "tarifa_base_extra",
  );
  const iva = numeroConfigurado(empresa.iva, "iva", { maximo: 1 });

  const rangos = [...rangosRecibidos].sort((a, b) =>
    Number(a.km_desde) - Number(b.km_desde)
  );
  for (const rango of rangos) {
    const desde = numeroConfigurado(rango.km_desde, "km_desde");
    numeroConfigurado(rango.precio, "precio de rango");
    const hasta = rango.km_hasta === null
      ? null
      : numeroConfigurado(rango.km_hasta, "km_hasta");
    if (hasta !== null && hasta < desde) {
      throw new Error(
        "La configuración corporativa contiene un rango inválido",
      );
    }
  }

  let precioBase: number;
  if (rangos.length > 0) {
    let rango = rangos.find((actual) => {
      const desde = Number(actual.km_desde);
      const hasta = actual.km_hasta === null ? null : Number(actual.km_hasta);
      return desde <= km && (hasta === null || km <= hasta);
    });

    /*
     * Compatibilidad con el cotizador frontend actual:
     * si ningún rango coincide, se utiliza el último rango configurado.
     * Cuando ese último rango es cerrado, se cobra únicamente su precio,
     * sin sumar kilómetros excedentes. Esta particularidad se conserva
     * intencionalmente en Fase 2 para no cambiar el precio ya mostrado al
     * cliente; revisar por separado si debe tratarse como rango abierto.
     */
    if (!rango) rango = rangos[rangos.length - 1];

    const desde = Number(rango.km_desde);
    const hasta = rango.km_hasta === null ? null : Number(rango.km_hasta);
    precioBase = Number(rango.precio);
    if (hasta === null && km > desde) {
      precioBase += kilometros(km - desde) * tarifaKm;
    }
  } else {
    precioBase = km <= kmMinimo
      ? tarifaMinima
      : tarifaBaseExtra + tarifaKm * (km - kmMinimo);
  }

  let cargoGrande = 0;
  if (tamanio === "grande") {
    cargoGrande = empresa.cargo_paquete_grande !== null
      ? numeroConfigurado(
        empresa.cargo_paquete_grande,
        "cargo_paquete_grande",
      )
      : numeroConfigurado(
        cargoGrandeGeneral,
        "cargo_paquete_grande general",
      );
  }

  const subtotal = dinero(precioBase + cargoGrande);
  // VIP no se calcula ni se aplica al camino corporativo.
  const ivaCalculado = dinero(subtotal * iva);
  return dinero(subtotal + ivaCalculado + cargoCancelacion);
}

function calcularPrecioReceta(
  empresa: EmpresaCorporativa,
  km: number,
  cargoCancelacion: number,
) {
  const tarifaReceta = numeroConfigurado(empresa.tarifa_receta, "tarifa_receta");
  const kmIncluidos = numeroConfigurado(
    empresa.km_incluidos_receta,
    "km_incluidos_receta",
  );
  const tarifaKmReceta = numeroConfigurado(
    empresa.tarifa_km_receta,
    "tarifa_km_receta",
  );
  const iva = numeroConfigurado(empresa.iva, "iva", { maximo: 1 });

  const precioBase = km <= kmIncluidos
    ? tarifaReceta
    : tarifaReceta + tarifaKmReceta * (km - kmIncluidos);

  const subtotal = dinero(precioBase);
  const ivaCalculado = dinero(subtotal * iva);
  return dinero(subtotal + ivaCalculado + cargoCancelacion);
}

function calcularPrecioTarifaDiaria(
  empresa: EmpresaCorporativa,
  tarifaCubierta: boolean,
  cargoCancelacion: number,
) {
  // Conserva el fallback histórico de tarifa diaria cuando no está definida.
  const tarifaDiaria = empresa.tarifa_diaria === null
    ? 380
    : numeroConfigurado(empresa.tarifa_diaria, "tarifa_diaria");
  const iva = numeroConfigurado(empresa.iva, "iva", { maximo: 1 });

  const base = tarifaCubierta ? 0 : dinero(tarifaDiaria * (1 + iva));

  // VIP y cargo_paquete_grande no participan en tarifa diaria.
  return dinero(base + cargoCancelacion);
}

function estadoInicial(metodo: string) {
  if (metodo === "transferencia") return "Pendiente verificación de pago";
  if (metodo === "tarjeta") return "Pendiente pago MP";
  if (metodo === "Crédito") return "Pendiente";
  return "Pendiente";
}

function estadoInicialProgramable(
  metodo: string,
  fechaPedido: string,
  fechaActualTenant: string,
) {
  const estadoNormal = estadoInicial(metodo);
  const admiteProgramacion = metodo === "efectivo" || metodo === "Crédito";
  return admiteProgramacion && fechaPedido > fechaActualTenant
    ? "Programado"
    : estadoNormal;
}

function errorRpc(mensaje: string) {
  if (mensaje.includes("SERVICIO_PAQUETERIA_INVALIDO")) {
    return [
      422,
      "El servicio de paquetería seleccionado no es válido.",
    ] as const;
  }
  if (mensaje.includes("CANTIDAD_BOLSAS_INVALIDA")) {
    return [
      422,
      "La cantidad de bolsas debe ser un número entero entre 0 y 5.",
    ] as const;
  }
  if (mensaje.includes("CANTIDAD_CAJAS_INVALIDA")) {
    return [
      422,
      "La cantidad de cajas debe ser un número entero entre 0 y 5.",
    ] as const;
  }
  if (mensaje.includes("CANTIDADES_PAQUETERIA_REQUERIDAS")) {
    return [422, "Ingresa al menos una bolsa o una caja."] as const;
  }
  if (mensaje.includes("COORDENADAS_RECOLECCION_INVALIDAS")) {
    return [
      422,
      "No pudimos validar la ubicación de recolección. Ajusta la dirección e intenta nuevamente.",
    ] as const;
  }
  if (mensaje.includes("PAQUETERIA_NO_PERMITIDA")) {
    return [
      403,
      "Tu empresa no tiene habilitados los envíos a paquetería.",
    ] as const;
  }
  if (mensaje.includes("MERCADO_LIBRE_NO_PERMITIDO")) {
    return [
      403,
      "Tu empresa no tiene habilitados los envíos a Mercado Libre.",
    ] as const;
  }
  if (mensaje.includes("CONFIGURACION_RECETA_INVALIDA")) {
    return [
      422,
      "El servicio de recolección de receta no está configurado correctamente. Contacta a soporte.",
    ] as const;
  }
  if (mensaje.includes("TARIFA_DIARIA_NO_SOPORTADA")) {
    return [
      409,
      "Este servicio no está disponible para cuentas con tarifa diaria.",
    ] as const;
  }
  if (mensaje.includes("TIPO_SERVICIO_INVALIDO")) {
    return [422, "El tipo de servicio no es válido."] as const;
  }
  if (mensaje.includes("RANGO_BOLSAS_NO_ENCONTRADO")) {
    return [
      422,
      "La cantidad de bolsas no coincide con una tarifa configurada. Ingresa una cantidad válida o contacta a soporte.",
    ] as const;
  }
  if (mensaje.includes("RANGO_CAJAS_NO_ENCONTRADO")) {
    return [
      422,
      "La cantidad de cajas no coincide con una tarifa configurada. Ingresa una cantidad válida o contacta a soporte.",
    ] as const;
  }
  if (mensaje.includes("TARIFA_PAQUETERIA_CAMBIO")) {
    return [
      409,
      "La tarifa de paquetería cambió mientras creábamos el pedido. Vuelve a cotizar.",
    ] as const;
  }
  if (mensaje.includes("LIMITE_CIUDAD_NO_CONFIGURADO")) {
    return [
      503,
      "La cobertura corporativa no está configurada. Contacta a soporte.",
    ] as const;
  }
  if (mensaje.includes("ULTIMA_PARADA_FUERA_LIMITE_CIUDAD")) {
    return [
      422,
      "La última parada está fuera del límite de cobertura de la ciudad.",
    ] as const;
  }
  if (mensaje.includes("ZONA_ULTIMA_PARADA_NO_DISPONIBLE")) {
    return [
      422,
      "La última parada no está dentro de una zona de servicio disponible.",
    ] as const;
  }
  if (mensaje.includes("PARADAS_INVALIDAS")) {
    return [422, "La información de las paradas no es válida."] as const;
  }
  if (mensaje.includes("MAXIMO_PARADAS_EXCEDIDO")) {
    return [422, "Un pedido puede incluir como máximo 8 paradas."] as const;
  }
  if (mensaje.includes("DISTANCIA_MULTIPARADA_CAMBIO")) {
    return [
      409,
      "La distancia de la ruta cambió. Vuelve a cotizar el envío.",
    ] as const;
  }
  if (mensaje.includes("CONFIGURACION_ZONA_INVALIDA")) {
    return [
      422,
      "La tarifa de la zona no está configurada correctamente. Contacta a soporte.",
    ] as const;
  }
  if (mensaje.includes("TARIFA_MULTIPARADA_CAMBIO")) {
    return [
      409,
      "La tarifa multiparada cambió mientras creábamos el pedido. Vuelve a cotizar.",
    ] as const;
  }
  if (mensaje.includes("EMPRESA_CORPORATIVA_NO_ENCONTRADA")) {
    return [
      403,
      "No encontramos la empresa corporativa asociada a tu cuenta.",
    ] as const;
  }
  if (mensaje.includes("EMPRESA_CORPORATIVA_INACTIVA")) {
    return [
      403,
      "La cuenta corporativa está inactiva. Contacta al administrador de tu empresa.",
    ] as const;
  }
  if (mensaje.includes("TARIFA_DIARIA_NO_SOPORTADA")) {
    return [
      409,
      "La tarifa diaria todavía no está disponible en este flujo.",
    ] as const;
  }
  if (mensaje.includes("FLUJO_TARIFA_DIARIA_REQUERIDO")) {
    return [
      409,
      "La cuenta ya no utiliza tarifa diaria. Vuelve a cotizar el pedido.",
    ] as const;
  }
  if (mensaje.includes("METODO_PAGO_TARIFA_DIARIA_INVALIDO")) {
    return [
      422,
      "Los pedidos de tarifa diaria deben utilizar el método de pago Crédito.",
    ] as const;
  }
  if (mensaje.includes("CUPON_NO_PERMITIDO_CORPORATIVO")) {
    return [
      409,
      "Los cupones no aplican a pedidos corporativos. Retira el cupón y vuelve a intentar.",
    ] as const;
  }
  if (
    mensaje.includes("CONFIGURACION_TARIFA_DIARIA_INVALIDA") ||
    mensaje.includes("CARGO_CANCELACION_INVALIDO")
  ) {
    return [
      422,
      "La tarifa diaria no está configurada correctamente. Contacta a soporte.",
    ] as const;
  }
  if (mensaje.includes("TARIFA_DIARIA_CAMBIO")) {
    return [
      409,
      "La tarifa diaria cambió mientras creábamos el pedido. Vuelve a cotizar.",
    ] as const;
  }
  if (
    mensaje.includes("CONFIGURACION_CORPORATIVA_INVALIDA") ||
    mensaje.includes("CONFIGURACION_RANGOS_EMPRESA_INVALIDA") ||
    mensaje.includes("CONFIGURACION_CARGO_GRANDE_INVALIDA")
  ) {
    return [
      422,
      "La tarifa corporativa no está configurada correctamente. Contacta a soporte.",
    ] as const;
  }
  if (mensaje.includes("TARIFA_CORPORATIVA_CAMBIO")) {
    return [
      409,
      "La tarifa corporativa cambió mientras creábamos el pedido. Vuelve a cotizar.",
    ] as const;
  }
  if (mensaje.includes("CLAVE_IDEMPOTENCIA_EN_USO")) {
    return [
      409,
      "La clave de esta solicitud ya fue utilizada por otro pedido.",
    ] as const;
  }
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
  if (mensaje.includes("TIPO_RECOLECCION_INVALIDO")) {
    return [422, "El tipo de recolección no es válido."] as const;
  }
  if (mensaje.includes("COMERCIO_NO_ENCONTRADO")) {
    return [404, "El comercio seleccionado no está disponible."] as const;
  }
  if (mensaje.includes("COMERCIO_TENANT_NO_COINCIDE")) {
    return [404, "El comercio seleccionado no está disponible."] as const;
  }
  if (mensaje.includes("COMERCIO_INACTIVO")) {
    return [
      422,
      "Este comercio ya no está disponible. Elige otro o continúa con una dirección libre.",
    ] as const;
  }
  if (mensaje.includes("COMERCIO_NO_ACEPTA_DEVOLUCIONES")) {
    return [422, "Este comercio no acepta devoluciones."] as const;
  }
  if (mensaje.includes("REFERENCIA_FACTURA_REQUERIDA")) {
    return [
      422,
      "Este comercio requiere el número de factura para recoger.",
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
    const modo = modoPaqueteria(cuerpo.modo);
    const esModoPaqueteria = modo !== null;
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
    let direccionRecoleccion = requerido(
      cuerpo.direccion_recoleccion,
      "direccion_recoleccion",
      300,
    );
    if (
      esModoPaqueteria &&
      cuerpo.paradas !== null &&
      cuerpo.paradas !== undefined
    ) {
      throw new Error(
        "Los pedidos de paquetería no admiten destinos ni paradas",
      );
    }
    const paradas = esModoPaqueteria
      ? null
      : validarParadas(cuerpo.paradas);
    const esMultiparada = paradas !== null;
    let direccionEntrega = esModoPaqueteria
      ? null
      : esMultiparada
      ? paradas[0].direccion
      : requerido(cuerpo.direccion_entrega, "direccion_entrega", 300);
    const instrucciones = opcional(cuerpo.instrucciones, "instrucciones", 500);
    const fecha = fechaValida(cuerpo.fecha);
    const tamanio = esModoPaqueteria
      ? "sobre"
      : requerido(cuerpo.tamanio, "tamanio", 20).toLowerCase();
    if (!TAMANIOS.has(tamanio)) {
      throw new Error("El tamaño de paquete no es válido");
    }
    const tipoServicioRecibido =
      opcional(cuerpo.tipo_servicio, "tipo_servicio", 20) ?? "directo";
    if (
      tipoServicioRecibido !== "directo" &&
      tipoServicioRecibido !== "con_recoleccion"
    ) {
      throw new Error("El tipo de servicio no es válido");
    }
    const bolsas = esModoPaqueteria
      ? cantidadPaqueteria(cuerpo.bolsas, "bolsas")
      : 0;
    const cajas = esModoPaqueteria
      ? cantidadPaqueteria(cuerpo.cajas, "cajas")
      : 0;
    if (esModoPaqueteria && bolsas === 0 && cajas === 0) {
      throw new Error("Ingresa al menos una bolsa o una caja");
    }
    const metodoRecibido = requerido(
      cuerpo.metodo_pago,
      "metodo_pago",
      30,
    );
    const metodo = METODOS_PAGO.get(
      metodoRecibido.toLocaleLowerCase("es-MX"),
    );
    if (!metodo) {
      throw new Error("El método de pago no es válido");
    }
    const comprobante = comprobanteValido(cuerpo.comprobante_pago, metodo);
    const claveIdempotencia = uuid(cuerpo.idempotency_key, "idempotency_key");
    let latRecoleccion = latitud(cuerpo.lat_recoleccion, "lat_recoleccion");
    let lngRecoleccion = longitud(cuerpo.lng_recoleccion, "lng_recoleccion");
    let latEntrega = esModoPaqueteria
      ? null
      : esMultiparada
      ? paradas[0].lat
      : latitud(cuerpo.lat_entrega, "lat_entrega");
    let lngEntrega = esModoPaqueteria
      ? null
      : esMultiparada
      ? paradas[0].lng
      : longitud(cuerpo.lng_entrega, "lng_entrega");
    const km = esModoPaqueteria
      ? 0
      : kilometros(numero(cuerpo.km_recorridos, "km_recorridos"));
    const codigoCupon =
      opcional(cuerpo.cupon_codigo, "cupon_codigo", 50)?.toUpperCase() ?? null;

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
    // usuarios.empresa_codigo es la única fuente de verdad. La metadata
    // de Auth no participa en la selección del camino.
    const empresaCodigo = typeof perfil.empresa_codigo === "string"
      ? perfil.empresa_codigo.trim()
      : "";
    const esCorporativo = empresaCodigo.length > 0;
    const tenant = perfil.tenant_id;

    if (
      tipoServicioRecibido === "con_recoleccion" &&
      (!esCorporativo || esMultiparada || esModoPaqueteria)
    ) {
      return responder(req, {
        error:
          "El servicio de recolección de receta solo está disponible para pedidos corporativos directos.",
      }, 422);
    }

    // ── Comercios afiliados (Fase 2) ──────────────────────────────────────
    // Único camino soportado por ahora: precio general (no paquetería, no
    // multiparada, no corporativo). El lado del comercio se resuelve aquí
    // desde comercios_afiliados — nunca desde el payload del cliente — y la
    // RPC lo vuelve a resolver como última línea de defensa.
    let comercio:
      | {
        id: string;
        direccion: string;
        lat: number;
        lng: number;
        acepta_devoluciones: boolean;
        requiere_factura: boolean;
      }
      | null = null;
    let tipoRecoleccion: "recoger" | "devolucion" | null = null;
    let referenciaRecoleccion: string | null = null;

    const comercioAfiliadoIdRecibido = opcional(
      cuerpo.comercio_afiliado_id,
      "comercio_afiliado_id",
      100,
    );

    if (comercioAfiliadoIdRecibido) {
      if (esModoPaqueteria || esMultiparada) {
        return responder(req, {
          error:
            "Los pedidos de comercios afiliados no admiten paquetería ni múltiples paradas todavía.",
        }, 422);
      }
      if (esCorporativo) {
        return responder(req, {
          error:
            "Los comercios afiliados no están disponibles para cuentas corporativas todavía.",
        }, 422);
      }

      const comercioAfiliadoId = uuid(
        comercioAfiliadoIdRecibido,
        "comercio_afiliado_id",
      );
      const tipoRecoleccionRecibido = requerido(
        cuerpo.tipo_recoleccion,
        "tipo_recoleccion",
        20,
      ).toLowerCase();
      if (
        tipoRecoleccionRecibido !== "recoger" &&
        tipoRecoleccionRecibido !== "devolucion"
      ) {
        throw new Error("El tipo de recolección no es válido");
      }
      tipoRecoleccion = tipoRecoleccionRecibido as "recoger" | "devolucion";
      referenciaRecoleccion = opcional(
        cuerpo.referencia_recoleccion,
        "referencia_recoleccion",
        100,
      );

      const { data: comercioData, error: falloComercio } = await admin
        .from("comercios_afiliados")
        .select(
          "id, tenant_id, direccion, lat, lng, activo, acepta_devoluciones, requiere_factura",
        )
        .eq("id", comercioAfiliadoId)
        .maybeSingle();
      if (falloComercio) {
        console.error(
          "[crear-pedido-local] No se pudo verificar el comercio afiliado:",
          falloComercio.message,
        );
        throw new Error("No pudimos verificar el comercio seleccionado");
      }
      if (!comercioData || comercioData.tenant_id !== tenant) {
        return responder(req, {
          error: "El comercio seleccionado no está disponible.",
        }, 404);
      }
      if (comercioData.activo !== true) {
        return responder(req, {
          error:
            "Este comercio ya no está disponible. Elige otro o continúa con una dirección libre.",
        }, 422);
      }
      if (
        tipoRecoleccion === "devolucion" &&
        comercioData.acepta_devoluciones !== true
      ) {
        return responder(req, {
          error: "Este comercio no acepta devoluciones.",
        }, 422);
      }
      if (
        tipoRecoleccion === "recoger" &&
        comercioData.requiere_factura === true &&
        !referenciaRecoleccion
      ) {
        return responder(req, {
          error: "Este comercio requiere el número de factura para recoger.",
        }, 422);
      }

      comercio = {
        id: comercioData.id,
        direccion: comercioData.direccion,
        lat: comercioData.lat,
        lng: comercioData.lng,
        acepta_devoluciones: comercioData.acepta_devoluciones,
        requiere_factura: comercioData.requiere_factura,
      };

      // El lado del comercio nunca sale del navegador: se sobreescribe aquí
      // sin importar qué haya llegado en direccion_recoleccion/lat/lng (o su
      // equivalente de entrega) en el payload.
      if (tipoRecoleccion === "recoger") {
        direccionRecoleccion = comercio.direccion;
        latRecoleccion = comercio.lat;
        lngRecoleccion = comercio.lng;
      } else {
        direccionEntrega = comercio.direccion;
        latEntrega = comercio.lat;
        lngEntrega = comercio.lng;
      }

      if (tipoRecoleccion === "devolucion" && metodo === "efectivo") {
        return responder(req, {
          error:
            "Las devoluciones se pagan por adelantado. Elige tarjeta o transferencia.",
        }, 422);
      }
    }

    const puntoRecoleccion = {
      lat: latRecoleccion,
      lng: lngRecoleccion,
    };
    const puntoEntrega: Punto | null = esModoPaqueteria
      ? null
      : {
        lat: latEntrega as number,
        lng: lngEntrega as number,
      };
    // El servicio "con_recoleccion" fija recolección=entrega (domicilio del
    // cliente) por diseño: la línea recta entre ambos es siempre ~0 y no dice
    // nada sobre el km real (farmacia↔domicilio). Ese caso se valida aparte,
    // una vez resuelta la empresa, contra lat_farmacia/lng_farmacia.
    if (
      !esModoPaqueteria && puntoEntrega &&
      tipoServicioRecibido !== "con_recoleccion"
    ) {
      const distanciaHaversine = esMultiparada
        ? paradas.reduce(
          (acumulado, parada, indice) =>
            acumulado +
            haversine(
              indice === 0 ? puntoRecoleccion : paradas[indice - 1],
              parada,
            ),
          0,
        )
        : haversine(puntoRecoleccion, puntoEntrega);
      validarDistancia(km, distanciaHaversine);
    }

    const { data: tenantConfigurado, error: falloTenant } = await admin
      .from("tenants")
      .select("id, zona_horaria")
      .eq("id", tenant)
      .maybeSingle();
    if (falloTenant) {
      console.error(
        "[crear-pedido-local] No se pudo consultar la zona horaria del tenant:",
        falloTenant.message,
      );
      return responder(req, {
        error: "No pudimos verificar la zona horaria de la cuenta",
      }, 503);
    }
    if (!tenantConfigurado) {
      return responder(req, { error: "El tenant del pedido no existe" }, 404);
    }
    const zonaHoraria = typeof tenantConfigurado.zona_horaria === "string"
      ? tenantConfigurado.zona_horaria.trim()
      : "";
    if (!zonaHoraria) {
      return responder(req, {
        error:
          "La zona horaria de esta cuenta todavía no está configurada. Contacta al administrador.",
      }, 422);
    }

    let fechaActualTenant: string;
    try {
      fechaActualTenant = hoyEnZonaHoraria(zonaHoraria);
    } catch (errorZonaHoraria) {
      console.error(
        "[crear-pedido-local] La zona horaria del tenant no es válida:",
        {
          tenant_id: tenant,
          zona_horaria: zonaHoraria,
          error: errorZonaHoraria instanceof Error
            ? errorZonaHoraria.message
            : String(errorZonaHoraria),
        },
      );
      return responder(req, {
        error:
          "La zona horaria de esta cuenta no está configurada correctamente. Contacta al administrador.",
      }, 422);
    }
    if (fecha < fechaActualTenant) {
      return responder(req, {
        error: "La fecha del pedido no puede estar en el pasado",
      }, 422);
    }

    if (fecha === fechaActualTenant) {
      const { data: configuracionTenant, error: falloConfiguracion } =
        await admin
          .from("configuracion")
          .select("horario_cierre")
          .eq("tenant_id", tenant)
          .maybeSingle();
      if (falloConfiguracion) {
        console.error(
          "[crear-pedido-local] No se pudo consultar el horario de cierre del tenant:",
          falloConfiguracion.message,
        );
        return responder(req, {
          error: "No pudimos verificar el horario de cierre de la cuenta",
        }, 503);
      }
      const horarioCierre =
        typeof configuracionTenant?.horario_cierre === "string"
          ? configuracionTenant.horario_cierre.slice(0, 5)
          : "15:00";
      const horaActualTenant = horaEnZonaHoraria(zonaHoraria);
      if (horaActualTenant >= horarioCierre) {
        return responder(req, {
          error:
            `Ya pasó la hora de cierre de hoy (${horarioCierre}). Selecciona una fecha futura.`,
        }, 422);
      }
    }

    const estadoPedido = estadoInicialProgramable(
      metodo,
      fecha,
      fechaActualTenant,
    );

    if (!esCorporativo && metodo === "Crédito") {
      return responder(req, {
        error:
          "El método Crédito solo está disponible para cuentas corporativas.",
      }, 403);
    }

    const cargoCancelacion = Math.max(
      0,
      dinero(Number(perfil.cargo_cancelacion) || 0),
    );

    /*
     * Paquetería y Mercado Libre son caminos corporativos de solo
     * recolección. Retorna antes de consultar zonas o validar cobertura.
     */
    if (esModoPaqueteria) {
      if (!esCorporativo) {
        return responder(req, {
          error:
            "Este servicio está disponible únicamente para cuentas corporativas.",
        }, 403);
      }
      if (codigoCupon) {
        return responder(req, {
          error:
            "Los cupones no aplican a pedidos corporativos. Retira el cupón y vuelve a intentar.",
        }, 409);
      }

      const { data: empresaData, error: falloEmpresa } = await admin
        .from("empresas_afiliadas")
        .select(
          "id, codigo, activa, tipo_tarifa, tarifa_diaria, tarifa_km, tarifa_minima, km_minimo, tarifa_base_extra, iva, cargo_paquete_grande, permite_paqueterias, permite_mercado_libre",
        )
        .eq("tenant_id", tenant)
        .eq("codigo", empresaCodigo)
        .maybeSingle();
      if (falloEmpresa) {
        console.error(
          "[crear-pedido-local] No se pudo resolver la empresa para paquetería:",
          falloEmpresa.message,
        );
        throw new Error("No pudimos verificar la cuenta corporativa");
      }
      if (!empresaData) {
        return responder(req, {
          error:
            "No encontramos la empresa corporativa asociada a tu cuenta.",
        }, 403);
      }

      const empresa = empresaData as EmpresaCorporativa;
      if (empresa.activa !== true) {
        return responder(req, {
          error:
            "La cuenta corporativa está inactiva. Contacta al administrador de tu empresa.",
        }, 403);
      }
      if (modo === "paqueteria" && empresa.permite_paqueterias !== true) {
        return responder(req, {
          error:
            "Tu empresa no tiene habilitados los envíos a paquetería.",
        }, 403);
      }
      if (
        modo === "mercado_libre" &&
        empresa.permite_mercado_libre !== true
      ) {
        return responder(req, {
          error:
            "Tu empresa no tiene habilitados los envíos a Mercado Libre.",
        }, 403);
      }

      let ivaEmpresa: number;
      try {
        ivaEmpresa = numeroConfigurado(empresa.iva, "iva", { maximo: 1 });
      } catch (errorConfiguracion) {
        console.error(
          "[crear-pedido-local] IVA corporativo inválido para paquetería:",
          errorConfiguracion instanceof Error
            ? errorConfiguracion.message
            : String(errorConfiguracion),
        );
        return responder(req, {
          error:
            "La tarifa de paquetería no está configurada correctamente. Contacta a soporte.",
        }, 422);
      }

      const { data: rangosData, error: falloRangos } = await admin
        .from("rangos_paqueteria")
        .select("tipo, cantidad_desde, cantidad_hasta, precio")
        .eq("empresa_id", empresa.id)
        .eq("servicio", modo)
        .order("cantidad_desde", { ascending: true })
        .order("cantidad_hasta", { ascending: true, nullsFirst: false })
        .order("precio", { ascending: true });
      if (falloRangos) {
        console.error(
          "[crear-pedido-local] No se pudieron consultar los rangos de paquetería:",
          falloRangos.message,
        );
        throw new Error("No pudimos verificar la tarifa de paquetería");
      }

      const rangos = (rangosData || []) as RangoPaqueteria[];
      const rangoBolsas = seleccionarRangoPaqueteria(
        rangos,
        "Bolsa",
        bolsas,
      );
      const rangoCajas = seleccionarRangoPaqueteria(rangos, "Caja", cajas);
      if (bolsas > 0 && !rangoBolsas) {
        return responder(req, {
          error:
            "La cantidad de bolsas no coincide con una tarifa configurada. Ingresa una cantidad válida o contacta a soporte.",
        }, 422);
      }
      if (cajas > 0 && !rangoCajas) {
        return responder(req, {
          error:
            "La cantidad de cajas no coincide con una tarifa configurada. Ingresa una cantidad válida o contacta a soporte.",
        }, 422);
      }

      const subtotalPaqueteria = dinero(
        (rangoBolsas?.precio ?? 0) + (rangoCajas?.precio ?? 0),
      );
      const ivaPaqueteria = dinero(subtotalPaqueteria * ivaEmpresa);
      const precioPaqueteria = dinero(
        subtotalPaqueteria + ivaPaqueteria + cargoCancelacion,
      );
      const tokenRastreo = crypto.randomUUID();
      const { data: resultadoRpc, error: falloRpc } = await admin.rpc(
        "crear_pedido_paqueteria_atomico",
        {
          p_user_id: user.id,
          p_tenant_id: tenant,
          p_idempotency_key: claveIdempotencia,
          p_servicio: modo,
          p_bolsas: bolsas,
          p_cajas: cajas,
          p_nombre: nombre,
          p_nombre_remitente: nombreRemitente,
          p_whatsapp: whatsapp,
          p_direccion_recoleccion: direccionRecoleccion,
          p_fecha: fecha,
          p_instrucciones: instrucciones,
          p_metodo_pago: metodo,
          p_comprobante_pago: comprobante,
          p_estado: estadoPedido,
          p_token_rastreo: tokenRastreo,
          p_lat_recoleccion: latRecoleccion,
          p_lng_recoleccion: lngRecoleccion,
          p_precio_cotizado: precioPaqueteria,
          p_cargo_cancelacion: cargoCancelacion,
          p_cupon_codigo: codigoCupon,
        },
      );
      if (falloRpc) {
        console.error(
          "[crear-pedido-local] La creación de paquetería atómica falló:",
          falloRpc.message,
        );
        const [estadoError, mensaje] = errorRpc(falloRpc.message);
        return responder(req, { error: mensaje }, estadoError);
      }

      const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : null;
      if (!resultado || !esObjeto(resultado.pedido)) {
        throw new Error(
          "El pedido de paquetería fue procesado, pero no pudimos recuperar el resultado",
        );
      }
      return responder(req, {
        data: [resultado.pedido],
        es_recuperacion_de_duplicado:
          resultado.es_recuperacion === true,
      });
    }

    const { data: zonas, error: falloZonas } = await admin.from(
      "zonas_cobertura",
    )
      .select(
        "id, nombre, coordenadas, precio_sobre, precio_grande, precio_por_km",
      ).eq("tenant_id", tenant).eq(
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
      !esMultiparada &&
      (!operativas.length ||
        (limite &&
          !puntoEnPoligono(
            latEntrega as number,
            lngEntrega as number,
            limite.poligono,
          )))
    ) {
      return responder(req, { error: ERROR_COBERTURA }, 422);
    }
    const puntoFinal = esMultiparada
      ? paradas[paradas.length - 1]
      : puntoEntrega as Punto;
    let zona: Zona & { poligono: Punto[] };
    if (esMultiparada && esCorporativo) {
      if (!limite) {
        return responder(req, {
          error:
            "La cobertura corporativa no está configurada. Contacta a soporte.",
        }, 503);
      }
      if (!puntoEnPoligono(puntoFinal.lat, puntoFinal.lng, limite.poligono)) {
        return responder(req, {
          error: "La última parada está fuera del límite de cobertura.",
        }, 422);
      }
      zona = limite;
    } else {
      const zonaEncontrada = operativas.find((z) =>
        puntoEnPoligono(puntoFinal.lat, puntoFinal.lng, z.poligono)
      );
      if (!zonaEncontrada) {
        return responder(
          req,
          {
            error: esMultiparada
              ? "La última parada no está dentro de una zona de servicio disponible."
              : ERROR_COBERTURA,
          },
          422,
        );
      }
      zona = zonaEncontrada;
    }

    if (esMultiparada) {
      let precioMultiparada = 0;

      if (esCorporativo) {
        if (codigoCupon) {
          return responder(req, {
            error:
              "Los cupones no aplican a pedidos corporativos. Retira el cupón y vuelve a intentar.",
          }, 409);
        }

        const { data: empresaData, error: falloEmpresa } = await admin
          .from("empresas_afiliadas")
          .select(
            "id, codigo, activa, tipo_tarifa, tarifa_diaria, tarifa_km, tarifa_minima, km_minimo, tarifa_base_extra, iva, cargo_paquete_grande",
          )
          .eq("tenant_id", tenant)
          .eq("codigo", empresaCodigo)
          .maybeSingle();
        if (falloEmpresa) {
          throw new Error("No pudimos verificar la cuenta corporativa");
        }
        if (!empresaData) {
          return responder(req, {
            error:
              "No encontramos la empresa corporativa asociada a tu cuenta.",
          }, 403);
        }

        const empresa = empresaData as EmpresaCorporativa;
        if (empresa.activa !== true) {
          return responder(req, {
            error:
              "La cuenta corporativa está inactiva. Contacta al administrador de tu empresa.",
          }, 403);
        }
        const tipoTarifa = typeof empresa.tipo_tarifa === "string"
          ? empresa.tipo_tarifa.trim().toLowerCase()
          : "";
        if (!tipoTarifa) {
          return responder(req, {
            error:
              "La tarifa corporativa no está configurada correctamente. Contacta a soporte.",
          }, 422);
        }

        if (tipoTarifa === "diaria") {
          if (metodo !== "Crédito") {
            return responder(req, {
              error:
                "Los pedidos de tarifa diaria deben utilizar el método de pago Crédito.",
            }, 422);
          }
          const { data: pedidosDiarios, error: falloPedidosDiarios } =
            await admin
              .from("pedidos")
              .select("fecha")
              .eq("tenant_id", tenant)
              .eq("empresa_codigo", empresaCodigo)
              .eq("metodo_pago", "Crédito")
              .neq("estado", "Cancelado")
              .eq("credito_cobrado", false)
              .eq("fecha", fecha);
          if (falloPedidosDiarios) {
            return responder(req, {
              error:
                "No pudimos verificar la tarifa diaria. Intenta nuevamente.",
            }, 503);
          }
          const tarifaCubierta = (
            (pedidosDiarios || []) as PedidoCoberturaDiaria[]
          ).length > 0;
          try {
            precioMultiparada = calcularPrecioTarifaDiaria(
              empresa,
              tarifaCubierta,
              cargoCancelacion,
            );
          } catch {
            return responder(req, {
              error:
                "La tarifa diaria no está configurada correctamente. Contacta a soporte.",
            }, 422);
          }
        } else {
          const promesaRangos = admin.from("rangos_precio_empresa")
            .select("km_desde, km_hasta, precio")
            .eq("empresa_id", empresa.id)
            .order("km_desde");
          const promesaCargoGeneral =
            tamanio === "grande" && empresa.cargo_paquete_grande === null
              ? admin.from("precios_generales")
                .select("cargo_paquete_grande")
                .eq("tenant_id", tenant)
                .maybeSingle()
              : Promise.resolve({ data: null, error: null });
          const [respuestaRangos, respuestaCargoGeneral] = await Promise.all([
            promesaRangos,
            promesaCargoGeneral,
          ]);
          if (respuestaRangos.error || respuestaCargoGeneral.error) {
            throw new Error("No pudimos verificar la tarifa corporativa");
          }
          try {
            const datosCargo = esObjeto(respuestaCargoGeneral.data)
              ? respuestaCargoGeneral.data
              : null;
            precioMultiparada = calcularPrecioCorporativo(
              empresa,
              (respuestaRangos.data || []) as Rango[],
              km,
              tamanio,
              datosCargo?.cargo_paquete_grande,
              cargoCancelacion,
            );
          } catch {
            return responder(req, {
              error:
                "La tarifa corporativa no está configurada correctamente. Contacta a soporte.",
            }, 422);
          }
        }
      } else {
        const precioBase = Number(
          tamanio === "sobre" ? zona.precio_sobre : zona.precio_grande,
        );
        const precioPorKm = zona.precio_por_km === null ||
            zona.precio_por_km === undefined
          ? 0
          : Number(zona.precio_por_km);
        if (
          !Number.isFinite(precioBase) || precioBase < 0 ||
          !Number.isFinite(precioPorKm) || precioPorKm < 0
        ) {
          return responder(req, {
            error:
              "La tarifa de la zona no está configurada correctamente. Contacta a soporte.",
          }, 422);
        }

        let subtotal = precioPorKm > 0
          ? dinero(precioBase + km * precioPorKm)
          : dinero(precioBase + (paradas.length - 1) * 30);
        if (tamanio === "grande") {
          const { data: preciosGenerales, error: falloPreciosGenerales } =
            await admin.from("precios_generales")
              .select("cargo_paquete_grande")
              .eq("tenant_id", tenant)
              .maybeSingle();
          const cargoGrande = Number(preciosGenerales?.cargo_paquete_grande);
          if (
            falloPreciosGenerales || !Number.isFinite(cargoGrande) ||
            cargoGrande < 0
          ) {
            return responder(req, {
              error:
                "La tarifa de paquete grande no está configurada correctamente.",
            }, 422);
          }
          subtotal = dinero(subtotal + cargoGrande);
        }
        const totalAntesCupon = dinero(subtotal + cargoCancelacion);
        let descuentoCupon = 0;
        if (codigoCupon) {
          const { data, error } = await admin.from("cupones")
            .select(
              "id, codigo, tipo, descuento, fecha_expiracion, usos_maximos, usos_actuales, usos_por_usuario",
            )
            .eq("tenant_id", tenant)
            .eq("codigo", codigoCupon)
            .maybeSingle();
          if (error) throw new Error("No pudimos validar el cupón");
          if (!data) {
            return responder(req, {
              error: "El cupón no está disponible",
            }, 409);
          }
          const cupon = data as Cupon;
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
            const { data: uso, error: falloUso } = await admin
              .from("cupones_usos")
              .select("usos")
              .eq("cupon_id", cupon.id)
              .eq("user_id", user.id)
              .maybeSingle();
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
        precioMultiparada = Math.max(
          0,
          dinero(totalAntesCupon - descuentoCupon),
        );
      }

      const tokenRastreo = crypto.randomUUID();
      const { data: resultadoRpc, error: falloRpc } = await admin.rpc(
        "crear_pedido_multiparada_atomico",
        {
          p_user_id: user.id,
          p_tenant_id: tenant,
          p_idempotency_key: claveIdempotencia,
          p_nombre: nombre,
          p_nombre_remitente: nombreRemitente,
          p_whatsapp: whatsapp,
          p_direccion_recoleccion: direccionRecoleccion,
          p_fecha: fecha,
          p_tamanio: tamanio,
          p_precio_cotizado: precioMultiparada,
          p_estado: estadoPedido,
          p_instrucciones: instrucciones,
          p_metodo_pago: metodo,
          p_comprobante_pago: comprobante,
          p_token_rastreo: tokenRastreo,
          p_km_recorridos: km,
          p_lat_recoleccion: latRecoleccion,
          p_lng_recoleccion: lngRecoleccion,
          p_cargo_cancelacion: cargoCancelacion,
          p_cupon_codigo: esCorporativo ? null : codigoCupon,
          p_paradas: paradas,
        },
      );
      if (falloRpc) {
        console.error(
          "[crear-pedido-local] La creación multiparada atómica falló:",
          falloRpc.message,
        );
        const [estado, mensaje] = errorRpc(falloRpc.message);
        return responder(req, { error: mensaje }, estado);
      }
      const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : null;
      if (
        !resultado || !esObjeto(resultado.pedido) ||
        !Array.isArray(resultado.paradas)
      ) {
        throw new Error(
          "El pedido multiparada fue procesado, pero no pudimos recuperar el resultado",
        );
      }
      return responder(req, {
        data: [resultado.pedido],
        paradas: resultado.paradas,
        es_recuperacion_de_duplicado: resultado.es_recuperacion === true,
      });
    }

    if (esCorporativo) {
      if (codigoCupon) {
        return responder(req, {
          error:
            "Los cupones no aplican a pedidos corporativos. Retira el cupón y vuelve a intentar.",
        }, 409);
      }

      // Primero resuelve la empresa por tenant + código del usuario.
      // Solo después consulta rangos por el empresa_id resultante.
      const { data: empresaData, error: falloEmpresa } = await admin
        .from("empresas_afiliadas")
        .select(
          "id, codigo, activa, tipo_tarifa, tarifa_diaria, tarifa_km, tarifa_minima, km_minimo, tarifa_base_extra, iva, cargo_paquete_grande, tarifa_receta, km_incluidos_receta, tarifa_km_receta, lat_farmacia, lng_farmacia",
        )
        .eq("tenant_id", tenant)
        .eq("codigo", empresaCodigo)
        .maybeSingle();

      if (falloEmpresa) {
        console.error(
          "[crear-pedido-local] No se pudo resolver la empresa:",
          falloEmpresa.message,
        );
        throw new Error("No pudimos verificar la cuenta corporativa");
      }
      if (!empresaData) {
        return responder(req, {
          error: "No encontramos la empresa corporativa asociada a tu cuenta.",
        }, 403);
      }

      const empresa = empresaData as EmpresaCorporativa;
      if (empresa.activa !== true) {
        return responder(req, {
          error:
            "La cuenta corporativa está inactiva. Contacta al administrador de tu empresa.",
        }, 403);
      }

      const tipoTarifa = typeof empresa.tipo_tarifa === "string"
        ? empresa.tipo_tarifa.trim().toLowerCase()
        : "";
      if (!tipoTarifa) {
        return responder(req, {
          error:
            "La tarifa corporativa no está configurada correctamente. Contacta a soporte.",
        }, 422);
      }
      if (tipoServicioRecibido === "con_recoleccion" && tipoTarifa === "diaria") {
        return responder(req, {
          error: "Este servicio no está disponible para cuentas con tarifa diaria.",
        }, 409);
      }
      if (tipoServicioRecibido === "con_recoleccion") {
        const latFarmacia = Number(empresa.lat_farmacia);
        const lngFarmacia = Number(empresa.lng_farmacia);
        if (
          empresa.lat_farmacia === null || empresa.lng_farmacia === null ||
          !Number.isFinite(latFarmacia) || !Number.isFinite(lngFarmacia)
        ) {
          return responder(req, {
            error:
              "El servicio de recolección de receta no está configurado correctamente. Contacta a soporte.",
          }, 422);
        }
        try {
          validarDistancia(
            km,
            haversine({ lat: latFarmacia, lng: lngFarmacia }, puntoEntrega as Punto),
          );
        } catch (errorDistancia) {
          return responder(req, {
            error: errorDistancia instanceof Error
              ? errorDistancia.message
              : "La distancia cambió. Vuelve a cotizar el envío.",
          }, 422);
        }
      }
      if (tipoTarifa === "diaria") {
        if (metodo !== "Crédito") {
          return responder(req, {
            error:
              "Los pedidos de tarifa diaria deben utilizar el método de pago Crédito.",
          }, 422);
        }

        /*
         * Previsualización únicamente por fecha efectiva del servicio.
         * La RPC conserva la última palabra y realiza la reserva atómica.
         */
        const { data: pedidosDiarios, error: falloPedidosDiarios } = await admin
          .from("pedidos")
          .select("fecha")
          .eq("tenant_id", tenant)
          .eq("empresa_codigo", empresaCodigo)
          .eq("metodo_pago", "Crédito")
          .neq("estado", "Cancelado")
          .eq("credito_cobrado", false)
          .eq("fecha", fecha);

        if (falloPedidosDiarios) {
          console.error(
            "[crear-pedido-local] No se pudo previsualizar la cobertura diaria:",
            falloPedidosDiarios.message,
          );
          return responder(req, {
            error: "No pudimos verificar la tarifa diaria. Intenta nuevamente.",
          }, 503);
        }

        const tarifaCubierta = (
          (pedidosDiarios || []) as PedidoCoberturaDiaria[]
        ).length > 0;

        let precioTarifaDiaria: number;
        try {
          precioTarifaDiaria = calcularPrecioTarifaDiaria(
            empresa,
            tarifaCubierta,
            cargoCancelacion,
          );
        } catch (errorConfiguracion) {
          console.error(
            "[crear-pedido-local] Configuración de tarifa diaria inválida:",
            errorConfiguracion instanceof Error
              ? errorConfiguracion.message
              : String(errorConfiguracion),
          );
          return responder(req, {
            error:
              "La tarifa diaria no está configurada correctamente. Contacta a soporte.",
          }, 422);
        }

        const tokenRastreo = crypto.randomUUID();
        const { data: resultadoRpc, error: falloRpc } = await admin.rpc(
          "crear_pedido_tarifa_diaria_atomico",
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
            p_zona: "Corporativo · Tarifa diaria",
            p_precio_cotizado: precioTarifaDiaria,
            p_estado: estadoPedido,
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
            p_cupon_codigo: null,
          },
        );

        if (falloRpc) {
          console.error(
            "[crear-pedido-local] La creación de tarifa diaria atómica falló:",
            falloRpc.message,
          );
          const [estado, mensaje] = errorRpc(falloRpc.message);
          return responder(req, { error: mensaje }, estado);
        }

        const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : null;
        if (!resultado || !esObjeto(resultado.pedido)) {
          throw new Error(
            "El pedido de tarifa diaria fue procesado, pero no pudimos recuperar el resultado",
          );
        }
        return responder(req, {
          data: [resultado.pedido],
          es_recuperacion_de_duplicado: resultado.es_recuperacion === true,
        });
      }

      let precioCorporativo: number;
      if (tipoServicioRecibido === "con_recoleccion") {
        try {
          precioCorporativo = calcularPrecioReceta(empresa, km, cargoCancelacion);
        } catch (errorConfiguracion) {
          console.error(
            "[crear-pedido-local] Configuración de receta inválida:",
            errorConfiguracion instanceof Error
              ? errorConfiguracion.message
              : String(errorConfiguracion),
          );
          return responder(req, {
            error:
              "El servicio de recolección de receta no está configurado correctamente. Contacta a soporte.",
          }, 422);
        }
      } else {
        const promesaRangos = admin.from("rangos_precio_empresa")
          .select("km_desde, km_hasta, precio")
          .eq("empresa_id", empresa.id)
          .order("km_desde");
        const promesaCargoGeneral =
          tamanio === "grande" && empresa.cargo_paquete_grande === null
            ? admin.from("precios_generales")
              .select("cargo_paquete_grande")
              .eq("tenant_id", tenant)
              .maybeSingle()
            : Promise.resolve({ data: null, error: null });

        const [respuestaRangos, respuestaCargoGeneral] = await Promise.all([
          promesaRangos,
          promesaCargoGeneral,
        ]);
        if (respuestaRangos.error) {
          console.error(
            "[crear-pedido-local] No se pudieron cargar los rangos corporativos:",
            respuestaRangos.error.message,
          );
          throw new Error("No pudimos verificar la tarifa corporativa");
        }
        if (respuestaCargoGeneral.error) {
          console.error(
            "[crear-pedido-local] No se pudo cargar el cargo general:",
            respuestaCargoGeneral.error.message,
          );
          throw new Error("No pudimos verificar el cargo de paquete grande");
        }

        try {
          const datosCargo = esObjeto(respuestaCargoGeneral.data)
            ? respuestaCargoGeneral.data
            : null;
          precioCorporativo = calcularPrecioCorporativo(
            empresa,
            (respuestaRangos.data || []) as Rango[],
            km,
            tamanio,
            datosCargo?.cargo_paquete_grande,
            cargoCancelacion,
          );
        } catch (errorConfiguracion) {
          console.error(
            "[crear-pedido-local] Configuración corporativa inválida:",
            errorConfiguracion instanceof Error
              ? errorConfiguracion.message
              : String(errorConfiguracion),
          );
          return responder(req, {
            error:
              "La tarifa corporativa no está configurada correctamente. Contacta a soporte.",
          }, 422);
        }
      }

      const tokenRastreo = crypto.randomUUID();
      const { data: resultadoRpc, error: falloRpc } = await admin.rpc(
        "crear_pedido_corporativo_atomico",
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
          p_precio_cotizado: precioCorporativo,
          p_estado: estadoPedido,
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
          p_cupon_codigo: null,
          p_tipo_servicio: tipoServicioRecibido,
          p_receta_subestado: tipoServicioRecibido === "con_recoleccion"
            ? "esperando_recoleccion"
            : null,
        },
      );
      if (falloRpc) {
        console.error(
          "[crear-pedido-local] La creación corporativa atómica falló:",
          falloRpc.message,
        );
        const [estado, mensaje] = errorRpc(falloRpc.message);
        return responder(req, { error: mensaje }, estado);
      }

      const resultado = Array.isArray(resultadoRpc) ? resultadoRpc[0] : null;
      if (!resultado || !esObjeto(resultado.pedido)) {
        throw new Error(
          "El pedido corporativo fue procesado, pero no pudimos recuperar el resultado",
        );
      }
      return responder(req, {
        data: [resultado.pedido],
        es_recuperacion_de_duplicado: resultado.es_recuperacion === true,
      });
    }

    const [consultaPrecios, consultaRangos] = await Promise.all([
      admin.from("precios_generales")
        .select(
          "tarifa_base, km_minimo, precio_km_extra, iva, cargo_paquete_grande, cargo_servicio_mostrador",
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

    let cargoServicioMostrador = 0;
    if (comercio) {
      const cargoConfigurado = Number(precios.cargo_servicio_mostrador);
      if (!Number.isFinite(cargoConfigurado) || cargoConfigurado < 0) {
        throw new Error(
          "El cargo de servicio de mostrador no está configurado correctamente",
        );
      }
      cargoServicioMostrador = cargoConfigurado;
    }

    let subtotal = precioBase +
      (tamanio === "grande" ? cargoGrandeConfigurado : 0);
    subtotal = dinero(
      subtotal - dinero(subtotal * porcentajeVip(perfil.nivel_vip)),
    );
    const totalAntesCupon = dinero(
      subtotal + dinero(subtotal * iva) + cargoCancelacion + cargoServicioMostrador,
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
        p_estado: estadoPedido,
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
        p_comercio_afiliado_id: comercio?.id ?? null,
        p_tipo_recoleccion: tipoRecoleccion,
        p_referencia_recoleccion: referenciaRecoleccion,
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
