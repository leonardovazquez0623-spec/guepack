// Sólo PostgreSQL en memoria y datos ficticios. Extrae la consulta vigente del repo.
import { PGlite } from "@electric-sql/pglite";
const source = await Deno.readTextFile(
  new URL(
    "../../migrations/20260821020000_rastreo_publico_comercio.sql",
    import.meta.url,
  ),
);
const match = source.match(
  /select round\(avg\(c\.estrellas\)[\s\S]*?where c\.repartidor = v_pedido\.repartidor;/i,
);
if (!match) throw new Error("La consulta cambió; revisar la reproducción");
const query = match[0].replace(/into v_estrellas\s*/i, "").replace(
  "v_pedido.repartidor",
  "$1",
);
const db = new PGlite();
try {
  await db.exec(
    `create table public.calificaciones(tenant_id bigint,repartidor text,estrellas integer);
    insert into public.calificaciones values(1,'Nombre repetido',5),(2,'Nombre repetido',1);`,
  );
  const result = await db.query<{ round: string }>(query, ["Nombre repetido"]);
  if (Number(result.rows[0].round) !== 3) {
    throw new Error("Resultado inesperado");
  }
  console.log(
    "CONFIRMADO A4: consulta vigente devuelve 3.0; el repartidor del tenant 1 sólo recibió 5 estrellas",
  );
} finally {
  await db.close();
}
