import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// Logo de l'artisan (ART-5, DOC-8) : vérification du format et couleur de marque proposée,
// tirée des pixels les plus colorés du logo (jamais imposée : l'artisan valide).

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 octets par pixel. */
  data: Uint8Array;
}

export function detectImageType(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export function decodeImage(bytes: Buffer): DecodedImage {
  const type = detectImageType(bytes);
  if (type === "image/png") {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (type === "image/jpeg") {
    const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 256 });
    return { width: img.width, height: img.height, data: img.data };
  }
  throw new Error("format d'image non pris en charge");
}

/** Couleur dominante parmi les pixels opaques et saturés ; null si le logo est gris. */
export function dominantColor(img: DecodedImage): string | null {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  const step = Math.max(1, Math.floor((img.width * img.height) / 40_000));
  for (let i = 0; i < img.width * img.height; i += step) {
    const o = i * 4;
    const r = img.data[o]!, g = img.data[o + 1]!, b = img.data[o + 2]!, a = img.data[o + 3]!;
    if (a < 200) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.25 || max < 40 || max > 250 && min > 230) continue;
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  if (!best || best.n < 20) return null;
  const hex = (v: number) => Math.round(v / best.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`.toUpperCase();
}

/** Logo PNG prêt pour Typst : PNG tel quel, JPEG réencodé en PNG. */
export function toPng(bytes: Buffer, img: DecodedImage): Buffer {
  if (detectImageType(bytes) === "image/png") return bytes;
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  return PNG.sync.write(png);
}
