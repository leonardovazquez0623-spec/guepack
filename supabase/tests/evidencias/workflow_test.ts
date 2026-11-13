import { PGlite } from "@electric-sql/pglite";
import { unzipSync } from "fflate";
import {
  type Client,
  maintenance,
  processBatch,
  Storage,
} from "../../functions/evidencias-entrega/service.ts";
import { createZip } from "../../functions/evidencias-entrega/zip.ts";
import { createHandler } from "../../functions/evidencias-entrega/handler.ts";

const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const EMPTY = "33333333-3333-4333-8333-333333333333";
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(a: unknown, b: unknown) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );
}
async function rejects(fn: () => Promise<unknown>, part?: string) {
  try {
    await fn();
  } catch (e) {
    if (part) assert(String(e).includes(part), String(e));
    return;
  }
  throw new Error("Expected rejection");
}
class TestStorage extends Storage {
  objects = new Map<string, Uint8Array>();
  failRead = false;
  corruptZip = false;
  failRemoveAt = 0;
  removes = 0;
  constructor(public pg: PGlite) {
    super("http://unused", "test");
  }
  async put(bucket: string, path: string, bytes: Uint8Array) {
    this.objects.set(`${bucket}/${path}`, bytes);
    await this.pg.query(
      `insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)
      on conflict(bucket_id,name) do update set metadata=excluded.metadata`,
      [bucket, path, { size: bytes.length }],
    );
  }
  override read(
    bucket: string,
    path: string,
  ): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
    if (this.failRead && bucket === "evidencias") {
      return Promise.reject(new Error("TEST_READ_FAILURE"));
    }
    let data = this.objects.get(`${bucket}/${path}`);
    if (!data) return Promise.reject(new Error("TEST_NOT_FOUND"));
    if (this.corruptZip && bucket === "evidencias-zips") {
      data = data.slice();
      data[0] ^= 1;
    }
    return Promise.resolve(new Blob([new Uint8Array(data)]).stream());
  }
  override async upload(path: string, file: string, _size: number) {
    await this.put("evidencias-zips", path, await Deno.readFile(file));
  }
  async remove(bucket: string, paths: string[]) {
    for (const path of paths) {
      if (bucket === "evidencias" && ++this.removes === this.failRemoveAt) {
        return { error: new Error("TEST_PARTIAL_DELETE") };
      }
      this.objects.delete(`${bucket}/${path}`);
      await this.pg.query(
        "delete from storage.objects where bucket_id=$1 and name=$2",
        [bucket, path],
      );
    }
    return { error: null };
  }
}
async function harness() {
  const pg = new PGlite();
  await pg.exec(
    await Deno.readTextFile(new URL("./fixture.sql", import.meta.url)),
  );
  const storage = new TestStorage(pg);
  for (
    const path of [
      "GK-101/foto.jpg",
      "GK-101/firma.png",
      "GK-101/recoleccion.jpg",
      "comprobantes/101.jpg",
      "GK-102/foto.jpg",
      "GK-103/foto.jpg",
      "GK-104/parada-1.jpg",
      "GK-201/foto.jpg",
    ]
  ) {
    await storage.put(
      "evidencias",
      path,
      new TextEncoder().encode(`test-fixture:${path}`),
    );
  }
  await pg.exec(
    await Deno.readTextFile(
      new URL(
        "../../migrations/20261112010000_retiro_evidencias_entrega.sql",
        import.meta.url,
      ),
    ),
  );
  await pg.exec(
    await Deno.readTextFile(
      new URL(
        "../../migrations/20261112020000_cron_retiro_evidencias.sql",
        import.meta.url,
      ),
    ),
  );
  async function as<T>(
    user: string | null,
    sql: string,
    values: unknown[] = [],
    role = "authenticated",
  ) {
    return await pg.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        user || "",
      ]);
      await tx.exec(`set local role ${role}`);
      return (await tx.query<T>(sql, values)).rows;
    });
  }
  async function call<T>(
    name: string,
    args: Record<string, unknown>,
    user: string | null = null,
    role = "postgres",
  ): Promise<T> {
    const keys = Object.keys(args);
    const rows = await as<{ value: T }>(
      user,
      `select public.${name}(${
        keys.map((k, i) => `${k}=>$${i + 1}`).join(",")
      }) as value`,
      Object.values(args),
      role,
    );
    return rows[0].value;
  }
  const client = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (field: string, value: unknown) => {
          filters[field] = value;
          return builder;
        },
        maybeSingle: async () => ({
          data: (await pg.query(
            `select * from ${table} where ${
              Object.keys(filters).map((k, i) => `${k}=$${i + 1}`).join(
                " and ",
              )
            }`,
            Object.values(filters),
          )).rows[0] || null,
          error: null,
        }),
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        if (name === "evidencia_trabajos") {
          return {
            data: (await pg.query("select * from public.evidencia_trabajos()"))
              .rows,
            error: null,
          };
        }
        return { data: await call(name, args), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => storage.remove(bucket, paths),
        list: async (prefix: string) => ({
          data: [...storage.objects.keys()].filter((k) =>
            k.startsWith(`${bucket}/${prefix}/`)
          )
            .map((k) => ({ name: k.split("/").pop() })),
          error: null,
        }),
      }),
    },
  } as unknown as Client;
  const summary = (user = A, tenant = 1) =>
    call<
      {
        elegibles: number;
        lotes: { id: string; estado: string; vence_at: string }[];
      }
    >(
      "evidencia_resumen",
      { p_tenant: tenant },
      user,
      "authenticated",
    );
  const start = (key = crypto.randomUUID(), user = A, tenant = 1) =>
    call<string>(
      "evidencia_iniciar",
      { p_tenant: tenant, p_clave: key, p_user: user },
      null,
      "service_role",
    );
  const batch = async (id: string) =>
    (await pg.query<Record<string, unknown>>(
      "select * from evidencia_lotes where id=$1",
      [id],
    )).rows[0];
  return { pg, storage, client, as, call, summary, start, batch };
}

Deno.test("Histórico anterior a migración, 30 días exactos, reciente, sin fecha, sin evidencias y paradas", async () => {
  const h = await harness();
  try {
    equal((await h.summary()).elegibles, 3);
    equal((await h.summary(EMPTY)).elegibles, 0);
    await h.pg.exec(
      "update pedidos set entregado_at=now()-interval '30 days' where id=102",
    );
    equal((await h.summary()).elegibles, 4);
    await h.pg.exec(
      "update paradas set completada_at=now()-interval '1 day' where id=501",
    );
    equal((await h.summary()).elegibles, 3);
    equal(h.storage.objects.size, 8);
  } finally {
    await h.pg.close();
  }
});

Deno.test("Sin sesión y cruce de cliente/tenant denegados; RLS restrictiva supera política legacy abierta", async () => {
  const h = await harness();
  try {
    await rejects(
      () => h.call("evidencia_resumen", { p_tenant: 1 }, null, "authenticated"),
      "SESION",
    );
    await rejects(
      () =>
        h.call(
          "evidencia_iniciar",
          { p_tenant: 1, p_clave: crypto.randomUUID(), p_user: A },
          null,
          "anon",
        ),
      "permission denied",
    );
    await rejects(
      () =>
        h.call(
          "evidencia_iniciar",
          { p_tenant: 1, p_clave: crypto.randomUUID(), p_user: A },
          A,
          "authenticated",
        ),
      "permission denied",
    );
    await rejects(() => h.summary(B, 1), "SESION");
    await rejects(() => h.start(crypto.randomUUID(), A, 2), "SESION");
    equal((await h.summary(B, 2)).elegibles, 1);
    equal(
      (await h.as(
        B,
        "select name from storage.objects where name='GK-101/foto.jpg'",
      )).length,
      0,
    );
    equal(
      (await h.as(
        null,
        "select name from storage.objects where name='GK-101/foto.jpg'",
        [],
        "anon",
      )).length,
      0,
    );
    equal(
      (await h.as(
        A,
        "select name from storage.objects where name='GK-101/foto.jpg'",
      )).length,
      1,
    );
    await h.storage.put(
      "evidencias-zips",
      "fake/archive.zip",
      new Uint8Array([1]),
    );
    equal(
      (await h.as(
        A,
        "select name from storage.objects where bucket_id='evidencias-zips'",
      )).length,
      0,
    );
    await h.as(A, "delete from storage.objects where name='GK-101/foto.jpg'");
    assert(h.storage.objects.has("evidencias/GK-101/foto.jpg"));
    equal(
      (await h.pg.query(
        "select count(*)::int n from storage.objects where name='GK-101/foto.jpg'",
      )).rows,
      [{ n: 1 }],
    );
  } finally {
    await h.pg.close();
  }
});

Deno.test("Cerrar/consultar aviso no crea lotes ni borra; doble clic y claves distintas reutilizan lote activo", async () => {
  const h = await harness();
  try {
    await h.summary();
    await h.summary();
    equal(
      (await h.pg.query("select count(*)::int n from evidencia_lotes")).rows,
      [{ n: 0 }],
    );
    equal(h.storage.removes, 0);
    const key = crypto.randomUUID(), id = await h.start(key);
    equal(await h.start(key), id);
    equal(await h.start(), id);
    equal(
      (await h.pg.query("select count(*)::int n from evidencia_lotes")).rows,
      [{ n: 1 }],
    );
    await rejects(
      () => h.as(A, "update pedidos set foto_evidencia=null where id=101"),
      "EVIDENCIA_EN_PREPARACION",
    );
    await rejects(
      () =>
        h.as(
          A,
          "update pedidos set foto_recoleccion='GK-101/foto.jpg' where id=102",
        ),
      "EVIDENCIA_RESERVADA",
    );
    await rejects(
      () => h.as(A, "update pedidos set tenant_id=2 where id=104"),
      "EVIDENCIA_EN_PREPARACION",
    );
  } finally {
    await h.pg.close();
  }
});

Deno.test("ZIP íntegro por folio con manifest, sólo originales del lote eliminados, descarga repetible", async () => {
  const h = await harness();
  try {
    const id = await h.start();
    await processBatch(h.client, h.storage, id);
    const batch = await h.batch(id);
    equal(batch.estado, "listo");
    const zip = h.storage.objects.get(`evidencias-zips/${batch.zip_ruta}`)!;
    const unpacked = unzipSync(zip);
    equal(Object.keys(unpacked).sort(), [
      "GK-101/firma.png",
      "GK-101/foto.jpg",
      "GK-104/parada-1.jpg",
      "MANIFIESTO.json",
    ]);
    equal(
      new TextDecoder().decode(unpacked["GK-101/foto.jpg"]),
      "test-fixture:GK-101/foto.jpg",
    );
    equal(
      JSON.parse(new TextDecoder().decode(unpacked["MANIFIESTO.json"])).archivos
        .length,
      3,
    );
    for (
      const path of [
        "GK-101/recoleccion.jpg",
        "comprobantes/101.jpg",
        "GK-102/foto.jpg",
        "GK-103/foto.jpg",
        "GK-201/foto.jpg",
      ]
    ) {
      assert(h.storage.objects.has(`evidencias/${path}`), `Preservar ${path}`);
    }
    equal(
      (await h.pg.query(
        "select foto_evidencia,firma_evidencia from pedidos where id=101",
      )).rows,
      [{ foto_evidencia: null, firma_evidencia: null }],
    );
    assert(
      (await h.pg.query<{ evidencias_retiradas_at: string }>(
        "select evidencias_retiradas_at from paradas where id=501",
      )).rows[0].evidencias_retiradas_at,
    );
    equal((await h.pg.query("select count(*)::int n from pedidos")).rows, [{
      n: 5,
    }]);
    equal((await h.summary()).lotes.length, 1);
    equal(
      new Date(batch.vence_at as string).getTime() -
        new Date(batch.verificado_at as string).getTime(),
      86400000,
    );
    const first = new Uint8Array(
      await new Response(
        await h.storage.read("evidencias-zips", batch.zip_ruta as string),
      ).arrayBuffer(),
    );
    const retry = new Uint8Array(
      await new Response(
        await h.storage.read("evidencias-zips", batch.zip_ruta as string),
      ).arrayBuffer(),
    );
    equal([...first], [...retry]);
  } finally {
    await h.pg.close();
  }
});

Deno.test("Fallo de preparación o ZIP remoto corrupto conserva originales y permite reintentar mismo lote", async () => {
  const h = await harness();
  try {
    const id = await h.start();
    h.storage.failRead = true;
    await processBatch(h.client, h.storage, id);
    equal((await h.batch(id)).estado, "preparando");
    equal(h.storage.removes, 0);
    h.storage.failRead = false;
    h.storage.corruptZip = true;
    await processBatch(h.client, h.storage, id);
    equal((await h.batch(id)).estado, "preparando");
    equal(h.storage.removes, 0);
    h.storage.corruptZip = false;
    await processBatch(h.client, h.storage, id);
    equal((await h.batch(id)).estado, "listo");
    equal(
      (await h.pg.query("select count(*)::int n from evidencia_lotes")).rows,
      [{ n: 1 }],
    );
  } finally {
    await h.pg.close();
  }
});

Deno.test("Borrado parcial conserva referencia pendiente y ZIP; reintento completa sin otro lote", async () => {
  const h = await harness();
  try {
    const id = await h.start();
    h.storage.failRemoveAt = 2;
    await processBatch(h.client, h.storage, id);
    const batch = await h.batch(id);
    equal(batch.estado, "verificado");
    assert(batch.zip_ruta);
    equal(
      (await h.pg.query(
        "select count(*)::int n from evidencia_archivos where estado='eliminado'",
      )).rows,
      [{ n: 1 }],
    );
    assert(
      (await h.pg.query<{ foto_evidencia: string }>(
        "select foto_evidencia from pedidos where id=101",
      )).rows[0].foto_evidencia,
    );
    h.storage.failRemoveAt = 0;
    await processBatch(h.client, h.storage, id);
    equal((await h.batch(id)).estado, "listo");
    equal((await h.batch(id)).zip_ruta, batch.zip_ruta);
  } finally {
    await h.pg.close();
  }
});

Deno.test("Archivo reutilizado en otro registro/campo se conserva y sólo se retira la referencia seleccionada", async () => {
  const h = await harness();
  try {
    await h.pg.exec(
      "update pedidos set foto_recoleccion='GK-101/foto.jpg' where id=102",
    );
    const id = await h.start();
    await processBatch(h.client, h.storage, id);
    equal((await h.batch(id)).estado, "listo");
    assert(h.storage.objects.has("evidencias/GK-101/foto.jpg"));
    equal(
      (await h.pg.query("select foto_recoleccion from pedidos where id=102"))
        .rows,
      [{ foto_recoleccion: "GK-101/foto.jpg" }],
    );
    equal(
      (await h.pg.query("select foto_evidencia from pedidos where id=101"))
        .rows,
      [{ foto_evidencia: null }],
    );
    equal(
      (await h.pg.query(
        "select estado from evidencia_archivos where ruta='GK-101/foto.jpg'",
      )).rows,
      [{ estado: "compartido" }],
    );
  } finally {
    await h.pg.close();
  }
});

Deno.test("Una referencia histórica en otra tabla también conserva el original", async () => {
  const h = await harness();
  try {
    await h.pg.exec(
      `create table public.archivos_legacy(id integer,datos jsonb);
      insert into public.archivos_legacy values(1,'{"anexo":{"url":"https://project.supabase.co/storage/v1/object/public/evidencias/GK-101/foto.jpg"}}');`,
    );
    const id = await h.start();
    await processBatch(h.client, h.storage, id);
    equal((await h.batch(id)).estado, "listo");
    assert(h.storage.objects.has("evidencias/GK-101/foto.jpg"));
    equal(
      (await h.pg.query(
        "select estado from evidencia_archivos where ruta='GK-101/foto.jpg'",
      )).rows,
      [{ estado: "compartido" }],
    );
  } finally {
    await h.pg.close();
  }
});

Deno.test("Lease excluyente y fencing rechazan trabajador viejo; respuesta perdida de borrado se reconcilia", async () => {
  const h = await harness();
  try {
    const id = await h.start(),
      first = crypto.randomUUID(),
      second = crypto.randomUUID();
    assert(await h.call("evidencia_reclamar", { p_lote: id, p_lease: first }));
    equal(
      await h.call("evidencia_reclamar", { p_lote: id, p_lease: second }),
      null,
    );
    await h.pg.query(
      "update evidencia_lotes set lease_hasta=now()-interval '1 second' where id=$1",
      [id],
    );
    assert(await h.call("evidencia_reclamar", { p_lote: id, p_lease: second }));
    await rejects(
      () =>
        h.call("evidencia_verificar", {
          p_lote: id,
          p_lease: first,
          p_ruta: `${id}/${first}.zip`,
          p_sha: "a".repeat(64),
          p_bytes: 1,
        }),
      "LOTE_NO_RECLAMADO",
    );
    await h.call("evidencia_liberar", { p_lote: id, p_lease: second });
    h.storage.failRemoveAt = 2;
    await processBatch(h.client, h.storage, id);
    await h.storage.remove("evidencias", ["GK-101/foto.jpg"]); // Storage respondió pero el proceso murió antes de confirmar.
    h.storage.failRemoveAt = 0;
    await processBatch(h.client, h.storage, id);
    equal((await h.batch(id)).estado, "listo");
  } finally {
    await h.pg.close();
  }
});

Deno.test("Caducidad: acceso bloqueado por SQL; cron elimina ZIP y candidatos, jamás evidencias de no consentidos", async () => {
  const h = await harness();
  try {
    const id = await h.start();
    await processBatch(h.client, h.storage, id);
    await h.storage.put(
      "evidencias-zips",
      `${id}/candidate.zip`,
      new Uint8Array([1, 2, 3]),
    );
    await h.pg.query(
      "update evidencia_lotes set vence_at=now()-interval '1 second' where id=$1",
      [id],
    );
    equal((await h.summary()).lotes.length, 0);
    await maintenance(h.client, h.storage);
    equal((await h.batch(id)).estado, "expirado");
    assert(
      ![...h.storage.objects.keys()].some((k) =>
        k.startsWith("evidencias-zips/")
      ),
    );
    assert(h.storage.objects.has("evidencias/GK-201/foto.jpg"));
    // Candidato tardío de un trabajador que perdió su lease: también se recoge.
    await h.storage.put(
      "evidencias-zips",
      `${id}/late-candidate.zip`,
      new Uint8Array([1]),
    );
    await maintenance(h.client, h.storage);
    assert(
      ![...h.storage.objects.keys()].some((k) =>
        k.startsWith("evidencias-zips/")
      ),
    );
  } finally {
    await h.pg.close();
  }
});

Deno.test("Caduca un borrado parcial: reconcilia ausentes, conserva pendientes y permite otro lote", async () => {
  const h = await harness();
  try {
    const id = await h.start();
    h.storage.failRemoveAt = 2;
    await processBatch(h.client, h.storage, id);
    await h.storage.remove("evidencias", ["GK-101/foto.jpg"]);
    await h.pg.query(
      "update evidencia_lotes set vence_at=now()-interval '1 second' where id=$1",
      [id],
    );
    await maintenance(h.client, h.storage);
    equal((await h.batch(id)).estado, "expirado");
    equal(
      (await h.pg.query("select foto_evidencia from pedidos where id=101"))
        .rows,
      [{ foto_evidencia: null }],
    );
    assert(h.storage.objects.has("evidencias/GK-104/parada-1.jpg"));
    equal((await h.summary()).elegibles, 1);
    assert(await h.start() !== id);
  } finally {
    await h.pg.close();
  }
});

Deno.test("ZIP binario de varios chunks, CRC validado por descompresor independiente y rechazo de tamaños erróneos", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const binary = new Uint8Array(140000);
    for (let n = 0; n < binary.length; n++) binary[n] = n % 251;
    const zip = await createZip(`${dir}/good.zip`, [{
      name: "GK-1/foto.jpg",
      size: binary.length,
      open: () => Promise.resolve(new Blob([binary]).stream()),
    }]);
    const unpacked = unzipSync(await Deno.readFile(`${dir}/good.zip`));
    equal([...unpacked["GK-1/foto.jpg"]], [...binary]);
    assert(zip.bytes > binary.length);
    await rejects(
      () =>
        createZip(`${dir}/bad.zip`, [{
          name: "GK-1/foto.jpg",
          size: 10,
          open: () => Promise.resolve(new Blob([binary]).stream()),
        }]),
      "TAMANO",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("HTTP: sesión inválida, actor falsificado, otros clientes/tenants, recuperación y ZIP vencido", async () => {
  const h = await harness();
  try {
    let validations = 0;
    const handler = createHandler({
      admin: h.client,
      storage: h.storage,
      serviceKey: "test-service-key",
      clientForToken: (token) =>
        ({
          auth: {
            getUser: () => {
              validations++;
              return Promise.resolve({
                data: {
                  user: [A, B, EMPTY].includes(token)
                    ? {
                      id: token,
                      email_confirmed_at: "2026-01-01",
                      is_anonymous: false,
                    }
                    : null,
                },
                error: null,
              });
            },
          },
          rpc: async (name: string, args: Record<string, unknown>) => {
            try {
              return {
                data: await h.call(name, args, token, "authenticated"),
                error: null,
              };
            } catch (error) {
              return { data: null, error };
            }
          },
        }) as unknown as Client,
    });
    const req = (token: string, body: Record<string, unknown>) =>
      handler(
        new Request("http://local/evidencias", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: JSON.stringify(body),
        }),
      );
    equal(
      (await req("", {
        action: "start",
        tenant_id: 1,
        key: crypto.randomUUID(),
      })).status,
      401,
    );
    equal(
      (await req("expired-token", {
        action: "start",
        tenant_id: 1,
        key: crypto.randomUUID(),
      })).status,
      401,
    );
    equal(
      (await req(B, {
        action: "start",
        tenant_id: 1,
        key: crypto.randomUUID(),
        user_id: A,
      })).status,
      403,
    );
    equal(
      (await h.pg.query("select count(*)::int n from evidencia_lotes")).rows,
      [{ n: 0 }],
    );
    const response = await req(A, {
      action: "start",
      tenant_id: 1,
      key: crypto.randomUUID(),
      user_id: B,
    });
    equal(response.status, 200);
    const { id } = await response.json();
    equal((await h.batch(id)).user_id, A);
    equal(
      (await req(B, { action: "download", tenant_id: 2, batch_id: id })).status,
      404,
    );
    equal(
      (await req(EMPTY, { action: "download", tenant_id: 1, batch_id: id }))
        .status,
      404,
    );
    equal(
      (await req(A, { action: "download", tenant_id: 2, batch_id: id })).status,
      403,
    );
    equal(
      (await req("expired-token", {
        action: "download",
        tenant_id: 1,
        batch_id: id,
      })).status,
      401,
    );
    for (let n = 0; n < 2; n++) {
      const download = await req(A, {
        action: "download",
        tenant_id: 1,
        batch_id: id,
      });
      equal(download.status, 200);
      equal(download.headers.get("Cache-Control"), "no-store");
      assert(
        unzipSync(
          new Uint8Array(await download.arrayBuffer()),
        )["GK-101/foto.jpg"],
      );
    }
    await h.pg.query(
      "update evidencia_lotes set vence_at=now()-interval '1 second' where id=$1",
      [id],
    );
    equal(
      (await req(A, { action: "download", tenant_id: 1, batch_id: id })).status,
      410,
    );
    equal((await req(A, { action: "maintenance" })).status, 403);
    assert(validations >= 10);
  } finally {
    await h.pg.close();
  }
});
