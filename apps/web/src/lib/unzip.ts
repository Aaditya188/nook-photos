/**
 * Minimal ZIP reader — enough to walk a Google Takeout archive. Parses the
 * end-of-central-directory + central directory, then extracts entries on
 * demand: STORE (method 0) is a raw slice; DEFLATE (method 8) inflates via the
 * browser-native DecompressionStream('deflate-raw'). Zero dependencies.
 */
export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  offset: number; // local-header offset
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export async function readZipEntries(file: Blob): Promise<ZipEntry[]> {
  const size = file.size;
  // EOCD is within the last 64 KB (22-byte record + up to 64 KB comment).
  const tailLen = Math.min(size, 65_557);
  const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const cenCount = tail.getUint16(eocd + 10, true);
  const cenSize = tail.getUint32(eocd + 12, true);
  const cenOffset = tail.getUint32(eocd + 16, true);

  const cen = new DataView(await file.slice(cenOffset, cenOffset + cenSize).arrayBuffer());
  const entries: ZipEntry[] = [];
  let p = 0;
  const dec = new TextDecoder();
  for (let i = 0; i < cenCount && p + 46 <= cen.byteLength; i++) {
    if (cen.getUint32(p, true) !== CEN_SIG) break;
    const method = cen.getUint16(p + 10, true);
    const compressedSize = cen.getUint32(p + 20, true);
    const uncompressedSize = cen.getUint32(p + 24, true);
    const nameLen = cen.getUint16(p + 28, true);
    const extraLen = cen.getUint16(p + 30, true);
    const commentLen = cen.getUint16(p + 32, true);
    const offset = cen.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cen.buffer, cen.byteOffset + p + 46, nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extract one entry's bytes (reads its local header to find the data start). */
export async function extractEntry(file: Blob, entry: ZipEntry): Promise<Uint8Array> {
  // Local header: 30 bytes + name + extra; lengths there can differ from the
  // central dir, so read them fresh.
  const hdr = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
  const nameLen = hdr.getUint16(26, true);
  const extraLen = hdr.getUint16(28, true);
  const dataStart = entry.offset + 30 + nameLen + extraLen;
  const raw = await file.slice(dataStart, dataStart + entry.compressedSize).arrayBuffer();
  if (entry.method === 0) return new Uint8Array(raw);
  if (entry.method === 8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('Unsupported compression method ' + entry.method);
}
