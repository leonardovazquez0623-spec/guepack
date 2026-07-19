// comparador-nacional.js
// Requiere que ya tengas `db` y `SUPABASE_URL` inicializados globalmente.

const CARRIER_COLORS = {
  fedex:             { bg: '#4d148c', letra: 'Fx' },
  estafeta:          { bg: '#e30613', letra: 'Es' },
  dhl:               { bg: '#ffcc00', letra: 'DH', texto: '#d40511' },
  paquetexpress:     { bg: '#f7941d', letra: 'PX' },
  ampm:              { bg: '#00a3e0', letra: 'AM' },
  imile:             { bg: '#1a3c8c', letra: 'iM' },
  ninetynineminutes: { bg: '#111111', letra: '99' },
  sendex:            { bg: '#2e7d32', letra: 'Sx' },
  jyt:               { bg: '#e2231a', letra: 'JT' },
  default:           { bg: 'var(--gray-mid)', letra: '📦' },
};

function badgeCarrier(providerName) {
  const key = (providerName || '').toLowerCase().replace(/\s+/g, '');
  const c = CARRIER_COLORS[key] || CARRIER_COLORS.default;
  return `<div style="width:40px;height:40px;border-radius:50%;background:${c.bg};color:${c.texto || 'white'};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;font-family:Montserrat,sans-serif;flex-shrink:0">${c.letra}</div>`;
}

const EXTRAS = {
  recoleccion: { label: "Solicitar recolección a domicilio", icon: "repartidor", costo: 0 },
  // cajas:    { label: "Venta de cajas y sobres",              icon: "paquete",    costo: 35 },
  seguro:      { label: "🛡️ Protección GUEPACK (hasta $2,500)",                     costo: 45 },
};

let cotizacionActual    = null; // { quotation_id, opciones }
let opcionSeleccionada  = null;
let extrasSeleccionados = new Set();

const PAQUETERIAS_RECOLECCION_APROXIMADA = new Set([
  "dhl",
  "fedex",
  "estafeta",
  "ups",
  "quiken",
]);

function normalizarPaqueteriaRecoleccion(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function obtenerHoraMexico() {
  const partes = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return {
    dia: valores.weekday,
    hora: Number(valores.hour),
  };
}

function recoleccionAproximadaDisponible(opcion) {
  if (!opcion || EXTRAS.recoleccion.costo <= 0) return false;

  const paqueteria = normalizarPaqueteriaRecoleccion(opcion.paqueteria);
  if (!PAQUETERIAS_RECOLECCION_APROXIMADA.has(paqueteria)) return false;

  const servicio = normalizarPaqueteriaRecoleccion(opcion.servicio);
  if (
    (paqueteria === "paquetexpress" || paqueteria === "sendex") &&
    servicio.includes("sinrecoleccion")
  ) return false;

  const horaMexico = obtenerHoraMexico();
  const diaNormalizado = normalizarPaqueteriaRecoleccion(horaMexico.dia);
  const esFinDeSemana = diaNormalizado === "sabado" || diaNormalizado === "domingo";
  return !esFinDeSemana && horaMexico.hora < 12;
}

async function cotizarEnvio(origen, destino, paquete) {
  const { data: { session } } = await db.auth.getSession();

  const res = await fetch(`${SUPABASE_URL}/functions/v1/skydropx-cotizar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ origen, destino, paquete }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Error al cotizar");

  const costoRecoleccion = Number(json.costo_recoleccion);
  EXTRAS.recoleccion.costo = Number.isFinite(costoRecoleccion) && costoRecoleccion > 0
    ? costoRecoleccion
    : 0;
  cotizacionActual = json;
  renderComparador(json.opciones);
}

function renderComparador(opciones) {
  const contenedor = document.getElementById("comparador-envios");
  contenedor.innerHTML = `
    <h3 class="comparador-titulo" style="display:flex;align-items:center;gap:6px">${typeof GUEPACK_ICONS !== 'undefined' ? '<span style="display:inline-flex;width:20px;height:20px">' + GUEPACK_ICONS.paquete + '</span>' : ''} Opciones de envío</h3>
    <div class="comparador-lista">
      ${opciones.map((op, i) => `
        <div class="opcion-envio" data-index="${i}">
          ${badgeCarrier(op.paqueteria)}
          <div class="opcion-info">
            <div class="opcion-paqueteria">${op.paqueteria}</div>
            <div class="opcion-servicio">${op.servicio || ""}</div>
            <div class="opcion-tiempo">${formatearDias(op.dias_min, op.dias_max)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
            <div style="display:flex;align-items:center;gap:4px">
              ${op.medalla ? `<span style="font-size:14px;line-height:1">${op.medalla}</span>` : ''}
              <div class="opcion-precio">$${op.costo.toFixed(0)}</div>
            </div>
            <button class="btn-sel-opcion" data-index="${i}"
              style="font-size:11px;padding:6px 12px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-family:Montserrat,sans-serif;font-weight:700;cursor:pointer;white-space:nowrap">
              Seleccionar
            </button>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  contenedor.querySelectorAll(".btn-sel-opcion").forEach(btn => {
    btn.addEventListener("click", () => _nacConfirmarOpcion(parseInt(btn.dataset.index)));
  });
}

function formatearDias(min, max) {
  if (!min) return "Tiempo estimado no disponible";
  if (min === max || !max) return `${min} día${min > 1 ? "s" : ""}`;
  return `${min}-${max} días`;
}

function renderUpsell() {
  // Seguro activo por default
  extrasSeleccionados.add("seguro");

  const contenedor = document.getElementById("upsell-envios");
  contenedor.innerHTML = `
    <h3 class="upsell-titulo">Servicios adicionales</h3>
    <div class="upsell-lista">
      ${Object.entries(EXTRAS).map(([key, extra]) => {
        // La cobertura real se valida con Skydropx después de generar la guía.
        if (key === "recoleccion" && !recoleccionAproximadaDisponible(opcionSeleccionada)) return "";
        const iconHtml = extra.icon && typeof GUEPACK_ICONS !== "undefined"
          ? `<span style="display:inline-flex;width:16px;height:16px;vertical-align:middle">${GUEPACK_ICONS[extra.icon]}</span> `
          : "";
        const checked = key === "seguro" ? "checked" : "";
        return `
        <label class="upsell-item">
          <input type="checkbox" data-extra="${key}" ${checked}/>
          <span class="upsell-label">${iconHtml}${extra.label}${key === "recoleccion" ? ` (+$${extra.costo.toFixed(0)})` : ""}</span>
          ${key === "recoleccion" ? "" : `<span class="upsell-precio">+$${extra.costo}</span>`}
        </label>`;
      }).join("")}
    </div>
    <div class="upsell-total">
      Total: <span id="total-envio">$${opcionSeleccionada.costo.toFixed(0)}</span>
    </div>
  `;

  contenedor.querySelectorAll("input[data-extra]").forEach(input => {
    input.addEventListener("change", e => {
      const key = e.target.dataset.extra;
      if (e.target.checked) extrasSeleccionados.add(key);
      else extrasSeleccionados.delete(key);
      actualizarTotal();
      _nacRenderResumen();
    });
  });

  // Refleja el seguro marcado desde el primer render
  actualizarTotal();
}

function actualizarTotal() {
  let total = opcionSeleccionada.costo;
  extrasSeleccionados.forEach(key => (total += EXTRAS[key].costo));
  document.getElementById("total-envio").textContent = `$${total.toFixed(0)}`;
}
