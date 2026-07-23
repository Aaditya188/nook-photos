/**
 * Minimal EXIF reader for JPEG — pulls DateTimeOriginal, GPS, and orientation
 * from the APP1/TIFF block. Dependency-free; only the tags we need. Returns
 * null fields when absent (the uploader falls back to file mtime / sidecars).
 */
export interface ExifData {
  takenAt: string | null; // ISO
  latitude: number | null;
  longitude: number | null;
  orientation: number | null;
}

const EMPTY: ExifData = { takenAt: null, latitude: null, longitude: null, orientation: null };

export async function readExif(file: File): Promise<ExifData> {
  if (!/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return EMPTY;
  try {
    // EXIF lives near the top; 256 KB is plenty and keeps big files cheap.
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    return parse(new DataView(buf));
  } catch {
    return EMPTY;
  }
}

function parse(view: DataView): ExifData {
  if (view.getUint16(0) !== 0xffd8) return EMPTY; // not JPEG
  let offset = 2;
  const len = view.byteLength;
  while (offset < len - 4) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      // APP1 — check for "Exif\0\0"
      if (view.getUint32(offset + 4) === 0x45786966) {
        return parseTiff(view, offset + 10);
      }
    }
    if (marker === 0xda) break; // start of scan → no more metadata
    offset += 2 + size;
  }
  return EMPTY;
}

function parseTiff(view: DataView, start: number): ExifData {
  const le = view.getUint16(start) === 0x4949; // II = little-endian
  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);

  const ifd0 = start + u32(start + 4);
  const out: ExifData = { ...EMPTY };
  let exifIfd = 0;
  let gpsIfd = 0;

  const readIfd = (ifd: number, handler: (tag: number, type: number, count: number, valOff: number) => void) => {
    if (ifd + 2 > view.byteLength) return;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > view.byteLength) break;
      handler(u16(e), u16(e + 2), u32(e + 4), e + 8);
    }
  };

  const asciiAt = (off: number, count: number) => {
    let s = '';
    for (let i = 0; i < count - 1 && off + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(off + i));
    return s;
  };

  readIfd(ifd0, (tag, _type, _count, valOff) => {
    if (tag === 0x8769) exifIfd = start + u32(valOff);
    else if (tag === 0x8825) gpsIfd = start + u32(valOff);
    else if (tag === 0x0112) out.orientation = u16(valOff);
  });

  if (exifIfd) {
    readIfd(exifIfd, (tag, _type, count, valOff) => {
      // DateTimeOriginal (0x9003) — "YYYY:MM:DD HH:MM:SS"
      if (tag === 0x9003) {
        const strOff = count > 4 ? start + u32(valOff) : valOff;
        const raw = asciiAt(strOff, count);
        const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
        if (m) {
          const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
          if (!Number.isNaN(d.getTime())) out.takenAt = d.toISOString();
        }
      }
    });
  }

  if (gpsIfd) {
    let latRef = 'N';
    let lonRef = 'E';
    let lat: number | null = null;
    let lon: number | null = null;
    const rational3 = (off: number): number => {
      // three RATIONALs: deg, min, sec
      const r = (o: number) => u32(o) / (u32(o + 4) || 1);
      return r(off) + r(off + 8) / 60 + r(off + 16) / 3600;
    };
    readIfd(gpsIfd, (tag, _type, _count, valOff) => {
      if (tag === 0x0001) latRef = String.fromCharCode(view.getUint8(valOff));
      else if (tag === 0x0003) lonRef = String.fromCharCode(view.getUint8(valOff));
      else if (tag === 0x0002) lat = rational3(start + u32(valOff));
      else if (tag === 0x0004) lon = rational3(start + u32(valOff));
    });
    if (lat != null) out.latitude = latRef === 'S' ? -lat : lat;
    if (lon != null) out.longitude = lonRef === 'W' ? -lon : lon;
  }

  return out;
}
