/**
 * Given a face box (fractions of the image, top-left origin) and the image's
 * natural pixel size, compute how to place the image inside a square container
 * so the (padded) face fills it — shared by web (CSS %) and mobile (RN layout).
 */
export interface FaceCrop {
  /** Image display size as a percentage of the square container. */
  widthPct: number;
  heightPct: number;
  /** Image offset as a percentage of the container (usually negative). */
  leftPct: number;
  topPct: number;
}

export function faceCrop(
  box: [number, number, number, number],
  imgW: number,
  imgH: number,
  pad = 1.7,
): FaceCrop | null {
  if (!imgW || !imgH) return null;
  const [bx, by, bw, bh] = box;
  const fx = bx * imgW;
  const fy = by * imgH;
  const fw = bw * imgW;
  const fh = bh * imgH;
  if (fw <= 0 || fh <= 0) return null;
  // Square region centred on the face, expanded for a little breathing room.
  const side = Math.max(fw, fh) * pad;
  const rx = fx + fw / 2 - side / 2;
  const ry = fy + fh / 2 - side / 2;
  return {
    widthPct: (imgW / side) * 100,
    heightPct: (imgH / side) * 100,
    leftPct: (-rx / side) * 100,
    topPct: (-ry / side) * 100,
  };
}
