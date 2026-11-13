import { createHash } from "node:crypto";

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crcUpdate(crc: number, data: Uint8Array): number {
  for (const n of data) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8);
  return crc;
}
function record(size: number, values: [number, number, number][]): Uint8Array {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  for (const [offset, width, value] of values) {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  return bytes;
}
async function writeAll(file: Deno.FsFile, bytes: Uint8Array) {
  let n = 0;
  while (n < bytes.length) {
    const written = await file.write(bytes.subarray(n));
    if (written <= 0) throw new Error("ZIP_ESCRITURA_INCOMPLETA");
    n += written;
  }
}
export type Source = {
  name: string;
  size: number;
  open: () => Promise<ReadableStream<Uint8Array>>;
};
export type ManifestEntry = { name: string; bytes: number; sha256: string };

// ZIP sin compresión (las fotos ya están comprimidas). Memoria O(chunk),
// directorio central, CRC32 y tamaños reales. Sin ZIP64: lote <=100 MiB.
export async function createZip(path: string, sources: Source[]) {
  if (!sources.length || sources.length > 100) throw new Error("LOTE_INVALIDO");
  const file = await Deno.open(path, {
    read: true,
    write: true,
    createNew: true,
  });
  const entries: ManifestEntry[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const names = new Set<string>();
  async function add(source: Source) {
    if (
      names.has(source.name) ||
      !/^(GK-\d+\/[a-z0-9.-]+|MANIFIESTO.json)$/.test(source.name)
    ) {
      throw new Error("NOMBRE_ZIP_INVALIDO");
    }
    names.add(source.name);
    const name = encoder.encode(source.name), start = offset;
    const header = record(30, [[0, 4, 0x04034b50], [4, 2, 20], [6, 2, 0x800], [
      12,
      2,
      33,
    ], [26, 2, name.length]]);
    await writeAll(file, header);
    await writeAll(file, name);
    let size = 0, crc = 0xffffffff;
    const hash = createHash("sha256");
    for await (const chunk of await source.open()) {
      size += chunk.length;
      if (size > source.size || start + size > 110000000) {
        throw new Error("TAMANO_ORIGINAL_CAMBIO");
      }
      crc = crcUpdate(crc, chunk);
      hash.update(chunk);
      await writeAll(file, chunk);
    }
    if (size !== source.size) throw new Error("ORIGINAL_INCOMPLETO");
    crc = (crc ^ 0xffffffff) >>> 0;
    offset += 30 + name.length + size;
    await file.seek(start + 14, Deno.SeekMode.Start);
    await writeAll(file, record(12, [[0, 4, crc], [4, 4, size], [8, 4, size]]));
    await file.seek(offset, Deno.SeekMode.Start);
    central.push(
      record(46, [
        [0, 4, 0x02014b50],
        [4, 2, 20],
        [6, 2, 20],
        [8, 2, 0x800],
        [14, 2, 33],
        [16, 4, crc],
        [20, 4, size],
        [24, 4, size],
        [28, 2, name.length],
        [42, 4, start],
      ]),
      name,
    );
    entries.push({
      name: source.name,
      bytes: size,
      sha256: hash.digest("hex"),
    });
  }
  try {
    for (const source of sources) await add(source);
    const manifest = encoder.encode(
      JSON.stringify({ formato: 1, archivos: entries }, null, 2),
    );
    await add({
      name: "MANIFIESTO.json",
      size: manifest.length,
      open: () => Promise.resolve(new Blob([manifest]).stream()),
    });
    const centralSize = central.reduce((n, b) => n + b.length, 0);
    for (const bytes of central) await writeAll(file, bytes);
    await writeAll(
      file,
      record(22, [
        [0, 4, 0x06054b50],
        [8, 2, entries.length],
        [10, 2, entries.length],
        [12, 4, centralSize],
        [16, 4, offset],
      ]),
    );
    await file.sync();
  } finally {
    file.close();
  }
  // Releer los bytes escritos detecta errores de disco antes de subir.
  const opened = await Deno.open(path, { read: true });
  return { ...await digestStream(opened.readable), entries };
}

export async function digestStream(stream: ReadableStream<Uint8Array>) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}
