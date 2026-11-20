/* Compresión local. Sin red ni dependencias. API reutilizable: GuepImagenes.prepare(). */
(function (global) {
  'use strict';
  const VERSION = '1';
  const MAX_ORIGINAL = 3 * 1024 * 1024;
  const TARGET = 400 * 1024;
  const SIGNATURE_TARGET = 100 * 1024;
  const MESSAGE = 'No se pudo comprimir la imagen. Elige una foto de menos de 3 MB o vuelve a tomarla. Puedes reintentar sin cerrar este formulario.';
  let queue = Promise.resolve();
  const prepared = new WeakMap();
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const isImage = file => /^image\//i.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i.test(file.name || '');
  const extension = file => (file.name || '').split('.').pop()?.toLowerCase() || '';
  function failure() { const error = new Error(MESSAGE); error.code = 'COMPRESSION_FAILED'; return error; }
  function original(file, reason, metadata = {}) {
    if (isImage(file) && file.size >= MAX_ORIGINAL) throw failure();
    return { blob: file, extension: extension(file), contentType: file.type || 'application/octet-stream',
      originalBytes: file.size, bytes: file.size, changed: false, reason, ...metadata };
  }
  // Cabeceras acotadas: nunca cargar una foto completa como ArrayBuffer/Base64.
  async function inspect(file) {
    const buffer = await file.slice(0, 512 * 1024).arrayBuffer();
    const v = new DataView(buffer), n = v.byteLength;
    let width = null, height = null, orientation = 1, format = file.type;
    if (n >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) {
      width = v.getUint32(16); height = v.getUint32(20); format = 'image/png';
    } else if (n >= 4 && v.getUint16(0) === 0xffd8) {
      format = 'image/jpeg';
      let p = 2;
      while (p + 4 <= n) {
        if (v.getUint8(p++) !== 0xff) break;
        while (p < n && v.getUint8(p) === 0xff) p++;
        const marker = v.getUint8(p++);
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (p + 2 > n) break;
        const length = v.getUint16(p), start = p + 2, end = p + length;
        if (length < 2 || end > n) break;
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) {
          height = v.getUint16(start + 1); width = v.getUint16(start + 3);
        }
        if (marker === 0xe1 && length >= 16 && v.getUint32(start) === 0x45786966 && v.getUint16(start + 4) === 0) {
          const t = start + 6, little = v.getUint16(t) === 0x4949;
          if ((little || v.getUint16(t) === 0x4d4d) && v.getUint16(t + 2, little) === 42) {
            const ifd = t + v.getUint32(t + 4, little);
            if (ifd >= t && ifd + 2 <= end) {
              const count = Math.min(v.getUint16(ifd, little), 256);
              for (let i = 0; i < count; i++) {
                const entry = ifd + 2 + i * 12;
                if (entry + 12 > end) break;
                if (v.getUint16(entry, little) === 0x0112 && v.getUint16(entry + 2, little) === 3 && v.getUint32(entry + 4, little) === 1) {
                  const o = v.getUint16(entry + 8, little); if (o >= 1 && o <= 8) orientation = o;
                }
              }
            }
          }
        }
        p = end;
      }
    }
    const swapped = orientation >= 5 && orientation <= 8;
    return { rawWidth: width, rawHeight: height, width: swapped ? height : width,
      height: swapped ? width : height, orientation, format };
  }
  function dimensions(width, height, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  async function decode(file, metadata, maxSide) {
    if (typeof global.createImageBitmap === 'function') {
      const options = { imageOrientation: 'from-image' };
      if (metadata.width && metadata.height) {
        const size = dimensions(metadata.width, metadata.height, maxSide);
        options.resizeWidth = size.width; options.resizeHeight = size.height; options.resizeQuality = 'high';
      }
      try {
        const bitmap = await global.createImageBitmap(file, options);
        // Detecta decodificadores que ignoran la orientación solicitada al escalar.
        if (metadata.width && metadata.height &&
            (!bitmap.width || !bitmap.height ||
             Math.abs((bitmap.width / bitmap.height) / (metadata.width / metadata.height) - 1) > 0.02)) {
          bitmap.close();
        } else {
          return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
        }
      } catch (_) { /* Algunos decodificadores no admiten las opciones; usar imagen orientada nativa. */ }
    }
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.decoding = 'async';
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      return { image: img, width: img.naturalWidth, height: img.naturalHeight,
        release: () => { img.removeAttribute('src'); URL.revokeObjectURL(url); } };
    } catch (error) { img.removeAttribute('src'); URL.revokeObjectURL(url); throw error; }
  }
  async function encode(canvas, type, quality) {
    await pause();
    const blob = await new Promise((resolve, reject) => {
      try { canvas.toBlob(resolve, type, quality); } catch (error) { reject(error); }
    });
    if (!blob || !blob.size || blob.type !== type) throw failure();
    return blob;
  }
  async function compress(file, options) {
    if (!file) throw failure();
    if (!isImage(file)) return { blob: file, extension: extension(file), contentType: file.type || 'application/octet-stream',
      bytes: file.size, originalBytes: file.size, changed: false, reason: 'not-image' };
    const signature = options.kind === 'signature';
    // Las firmas pequeñas se conservan sin decodificar ni alterar trazos.
    if (signature && file.size <= SIGNATURE_TARGET) return original(file, 'small-signature');
    let decoded, canvas, metadata = {};
    const started = performance.now();
    try {
      metadata = await inspect(file);
      const maxSide = options.maxSide || 1600;
      if (!Number.isFinite(maxSide) || maxSide < 1 || maxSide > 1600) throw failure();
      decoded = await decode(file, metadata, maxSide);
      if (!decoded.width || !decoded.height) throw failure();
      const size = dimensions(decoded.width, decoded.height, maxSide);
      canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d'); if (!context) throw failure();
      // kind: artwork queda disponible para logos/mascotas futuros: siempre PNG con alfa.
      const type = signature || options.kind === 'artwork' ? 'image/png' : 'image/jpeg';
      if (type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height); }
      context.drawImage(decoded.image, 0, 0, size.width, size.height);
      decoded.release(); decoded = null;
      let best, quality = null, attempts = [];
      for (const q of type === 'image/png' ? [null] : [0.8, 0.75, 0.7, 0.65, 0.6]) {
        const blob = await encode(canvas, type, q);
        attempts.push({ quality: q, bytes: blob.size });
        if (!best || blob.size < best.size) { best = blob; quality = q; }
        if (best.size <= TARGET) break;
      }
      const info = { input: metadata, output: size, quality, attempts, durationMs: performance.now() - started };
      if (best.size >= file.size) return original(file, 'not-smaller', { ...info, output: { width: metadata.width, height: metadata.height } });
      return { blob: best, extension: type === 'image/png' ? 'png' : 'jpg', contentType: type,
        originalBytes: file.size, bytes: best.size, changed: true, reason: 'compressed', ...info };
    } catch (_) {
      return original(file, 'compression-failed', { input: metadata, durationMs: performance.now() - started });
    } finally {
      if (decoded) decoded.release();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  function prepare(file, options = {}) {
    const key = (options.kind || 'photo') + ':' + (options.maxSide || 1600);
    if (file && prepared.get(file)?.key === key) return prepared.get(file).result;
    const result = queue.then(() => compress(file, options));
    if (file) prepared.set(file, { key, result });
    result.then(value => {
      if (value.reason === 'compression-failed' && prepared.get(file)?.result === result) prepared.delete(file);
    }, () => { if (prepared.get(file)?.result === result) prepared.delete(file); });
    queue = result.catch(() => {}); // Un fallo no bloquea la siguiente foto/reintento.
    return result;
  }
  global.GuepImagenes = Object.freeze({ version: VERSION, prepare, inspect, dimensions });
})(globalThis);
