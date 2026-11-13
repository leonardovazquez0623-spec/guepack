import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.7";
import { createZip, digestStream } from "./zip.ts";

export type Client = SupabaseClient;
export type Ref = {
  pedido_id: number;
  tabla: string;
  registro_id: number;
  campo: string;
};
export type ArchiveFile = {
  id: number;
  ruta: string;
  bytes: number;
  estado: string;
  refs: Ref[];
};
export type Batch = {
  id: string;
  user_id: string;
  tenant_id: number;
  estado: string;
  creado_at: string;
  vence_at: string | null;
  zip_ruta: string | null;
  zip_sha256: string | null;
  zip_bytes: number | null;
  archivos: ArchiveFile[];
};

export async function rpc<T>(
  db: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export class Storage {
  constructor(private url: string, private key: string) {}
  private path(bucket: string, path: string) {
    return `${this.url}/storage/v1/object/${bucket}/${
      path.split("/").map(encodeURIComponent).join("/")
    }`;
  }
  async read(bucket: string, path: string) {
    const res = await fetch(this.path(bucket, path), {
      headers: { Authorization: `Bearer ${this.key}`, apikey: this.key },
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw new Error("STORAGE_LECTURA_FALLO");
    }
    return res.body;
  }
  async upload(path: string, file: string, size: number) {
    const opened = await Deno.open(file, { read: true });
    const res = await fetch(this.path("evidencias-zips", path), {
      method: "POST",
      body: opened.readable,
      headers: {
        Authorization: `Bearer ${this.key}`,
        apikey: this.key,
        "Content-Type": "application/zip",
        "Content-Length": String(size),
        "Cache-Control": "no-store",
        "x-upsert": "false",
      },
      signal: AbortSignal.timeout(90000),
    });
    await res.body?.cancel();
    if (!res.ok) throw new Error("STORAGE_ZIP_SUBIDA_FALLO");
  }
}

export async function processBatch(db: Client, storage: Storage, id: string) {
  const lease = crypto.randomUUID();
  const batch = await rpc<Batch | null>(db, "evidencia_reclamar", {
    p_lote: id,
    p_lease: lease,
  });
  if (!batch) return;
  let dir: string | undefined;
  try {
    if (batch.estado === "preparando") {
      dir = await Deno.makeTempDir({ prefix: "guep-evidencias-" });
      const local = `${dir}/evidencias.zip`;
      const zip = await createZip(
        local,
        batch.archivos.map((a) => ({
          name: a.ruta,
          size: a.bytes,
          open: () => storage.read("evidencias", a.ruta),
        })),
      );
      const path = `${id}/${lease}.zip`;
      await storage.upload(path, local, zip.bytes);
      // Descargar de nuevo el ZIP completo: no basta un HEAD ni obtener una URL.
      const remote = await digestStream(
        await storage.read("evidencias-zips", path),
      );
      if (remote.sha256 !== zip.sha256 || remote.bytes !== zip.bytes) {
        throw new Error("ZIP_VERIFICACION_FALLO");
      }
      await rpc(db, "evidencia_verificar", {
        p_lote: id,
        p_lease: lease,
        p_ruta: path,
        p_sha: zip.sha256,
        p_bytes: zip.bytes,
      });
      batch.zip_ruta = path;
      batch.zip_sha256 = zip.sha256;
      batch.zip_bytes = zip.bytes;
    } else if (batch.estado === "verificado") {
      // Cada reintento comprueba que sigue existiendo una copia íntegra.
      const remote = await digestStream(
        await storage.read("evidencias-zips", batch.zip_ruta!),
      );
      if (
        remote.sha256 !== batch.zip_sha256 || remote.bytes !== batch.zip_bytes
      ) throw new Error("ZIP_VERIFICACION_FALLO");
    }
    if (batch.estado !== "listo") {
      for (const file of batch.archivos) {
        if (!["reservado", "borrando"].includes(file.estado)) continue;
        const state = await rpc<string>(db, "evidencia_preparar_borrado", {
          p_archivo: file.id,
          p_lease: lease,
        });
        if (state === "borrando") {
          const { error } = await db.storage.from("evidencias").remove([
            file.ruta,
          ]);
          if (error) throw new Error("STORAGE_BORRADO_PENDIENTE");
        }
        if (state === "borrando" || state === "compartido") {
          await rpc(db, "evidencia_confirmar_borrado", {
            p_archivo: file.id,
            p_lease: lease,
            p_compartido: state === "compartido",
          });
        }
      }
    }
    await rpc(db, "evidencia_liberar", { p_lote: id, p_lease: lease });
  } catch (error) {
    // No se elimina un ZIP candidato aquí: una respuesta perdida de verificar
    // podría ocultar que ya es el ZIP válido. El recolector limpia todo el lote.
    await rpc(db, "evidencia_liberar", {
      p_lote: id,
      p_lease: lease,
      p_error: "REINTENTABLE",
    });
    console.error(
      "[evidencias-entrega]",
      id,
      error instanceof Error ? error.message : "ERROR",
    );
  } finally {
    if (dir) await Deno.remove(dir, { recursive: true });
  }
}

export async function maintenance(db: Client, storage: Storage) {
  const data = await rpc<Batch[]>(db, "evidencia_trabajos", {});
  let processed = 0;
  const start = Date.now();
  for (const batch of data || []) {
    if (Date.now() - start > 45000) break;
    try {
      const expired = await rpc<boolean>(db, "evidencia_expirar", {
        p_lote: batch.id,
      });
      if (expired) {
        // Cada intento vuelve a listar: también elimina candidatos de una
        // preparación interrumpida. Nunca borra originales en esta rama.
        for (;;) {
          if (Date.now() - start > 45000) return { processed };
          const { data: files, error: listError } = await db.storage.from(
            "evidencias-zips",
          ).list(batch.id, { limit: 100 });
          if (listError) throw listError;
          if (!files?.length) break;
          const { error: removeError } = await db.storage.from(
            "evidencias-zips",
          ).remove(files.map((f) => `${batch.id}/${f.name}`));
          if (removeError) throw removeError;
        }
        await rpc(db, "evidencia_expirar", {
          p_lote: batch.id,
          p_confirmar: true,
        });
        processed++;
      } else if (["preparando", "verificado"].includes(batch.estado)) {
        await processBatch(db, storage, batch.id);
        processed++;
      }
    } catch (error) {
      console.error(
        "[evidencias-entrega] mantenimiento pendiente",
        batch.id,
        error instanceof Error ? error.message : "ERROR",
      );
    }
  }
  return { processed };
}
