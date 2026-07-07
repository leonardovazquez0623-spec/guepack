// comparador-nacional.js
// Requiere que ya tengas `db` y `SUPABASE_URL` inicializados globalmente.

const EXTRAS = {
  recoleccion: { label: "🚚 Recolección a domicilio con GuePack", costo: 60 },
  cajas:       { label: "📦 Venta de cajas y sobres",             costo: 35 },
  seguro:      { label: "🛡️ Seguro adicional",                    costo: 45 },
  prioritario: { label: "⚡ Envío prioritario",                   costo: 80 },
};

let cotizacionActual    = null; // { quotation_id, opciones }
let opcionSeleccionada  = null;
let extrasSeleccionados = new Set();

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

  cotizacionActual = json;
  renderComparador(json.opciones);
}

function renderComparador(opciones) {
  const contenedor = document.getElementById("comparador-envios");
  contenedor.innerHTML = `
    <h3 class="comparador-titulo">📦 Opciones de envío</h3>
    <div class="comparador-lista">
      ${opciones.map((op, i) => `
        <div class="opcion-envio" data-index="${i}">
          <div class="opcion-medalla">${op.medalla || "📦"}</div>
          <div class="opcion-info">
            <div class="opcion-paqueteria">${op.paqueteria}</div>
            <div class="opcion-servicio">${op.servicio || ""}</div>
            <div class="opcion-tiempo">${formatearDias(op.dias_min, op.dias_max)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">
            <div class="opcion-precio">$${op.costo.toFixed(0)}</div>
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
  const contenedor = document.getElementById("upsell-envios");
  contenedor.innerHTML = `
    <h3 class="upsell-titulo">Servicios adicionales</h3>
    <div class="upsell-lista">
      ${Object.entries(EXTRAS).map(([key, extra]) => `
        <label class="upsell-item">
          <input type="checkbox" data-extra="${key}" />
          <span class="upsell-label">${extra.label}</span>
          <span class="upsell-precio">+$${extra.costo}</span>
        </label>
      `).join("")}
    </div>
    <div class="upsell-total">
      Total: <span id="total-envio">$${opcionSeleccionada.costo.toFixed(0)}</span>
    </div>
    <button id="btn-confirmar-envio" class="btn-primario">Actualizar resumen ✓</button>
  `;

  contenedor.querySelectorAll("input[data-extra]").forEach(input => {
    input.addEventListener("change", e => {
      const key = e.target.dataset.extra;
      if (e.target.checked) extrasSeleccionados.add(key);
      else extrasSeleccionados.delete(key);
      actualizarTotal();
    });
  });

  document.getElementById("btn-confirmar-envio")
    .addEventListener("click", () => _nacActualizarResumenConExtras());
}

function actualizarTotal() {
  let total = opcionSeleccionada.costo;
  extrasSeleccionados.forEach(key => (total += EXTRAS[key].costo));
  document.getElementById("total-envio").textContent = `$${total.toFixed(0)}`;
}
