// Getting a receipt photo ready to read. Phone photos show the receipt on a
// table or counter, and a patterned surface (granite, wood grain) is read as
// rows of junk text that break up the receipt's own lines. So: find the
// receipt -- the largest bright, colourless block -- crop to it, enlarge it
// so the small print is big enough, and stretch the contrast. Pure functions
// on RGBA pixel arrays; billScan.ts does the canvas work.

export type Box = { x: number; y: number; w: number; h: number };

// Otsu's threshold: the brightness that best separates two groups of pixels.
function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

// The longest run of values above `min`, bridging gaps of a few.
function longestRun(values: ArrayLike<number>, min: number, gap = 3): [number, number] {
  let bestStart = 0, bestEnd = -1, start = -1, misses = 0;
  for (let i = 0; i <= values.length; i++) {
    const on = i < values.length && values[i] > min;
    if (on) {
      if (start < 0) start = i;
      misses = 0;
    } else if (start >= 0 && (++misses > gap || i === values.length)) {
      const end = i - misses;
      if (end - start > bestEnd - bestStart) {
        bestStart = start;
        bestEnd = end;
      }
      start = -1;
      misses = 0;
    }
  }
  return [bestStart, bestEnd];
}

// Where the receipt is, in a small copy of the photo (width × height RGBA).
// Null when no clear receipt stands out -- then the whole photo is used.
export function findReceipt(rgba: ArrayLike<number>, width: number, height: number): Box | null {
  const n = width * height;
  const luma = new Float32Array(n);
  const paper = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    hist[Math.round(luma[i])]++;
  }
  const t = otsu(hist, n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    paper[i] = luma[i] > t && Math.max(r, g, b) - Math.min(r, g, b) < 45 ? 1 : 0;
  }
  const cols = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = 0; y < height; y++) c += paper[y * width + x];
    cols[x] = c / height;
  }
  const [x0, x1] = longestRun(cols, 0.35);
  if (x1 - x0 < width * 0.15) return null;
  const rows = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = x0; x <= x1; x++) c += paper[y * width + x];
    rows[y] = c / (x1 - x0 + 1);
  }
  const [y0, y1] = longestRun(rows, 0.5);
  if (y1 - y0 < height * 0.15) return null;
  // Nearly the whole photo is "paper": nothing to crop away.
  if ((x1 - x0) * (y1 - y0) > width * height * 0.9) return null;
  const m = Math.round(width * 0.012);
  const x = Math.max(0, x0 - m), y = Math.max(0, y0 - m);
  return { x, y, w: Math.min(width, x1 + m + 1) - x, h: Math.min(height, y1 + m + 1) - y };
}

// Grey, with the darkest 1% black and the lightest 3% white, in place.
export function grayStretch(rgba: Uint8ClampedArray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < rgba.length; i += 4) {
    const l = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    rgba[i] = l;
    hist[l]++;
  }
  const n = rgba.length / 4;
  let acc = 0, lo = 0, hi = 255;
  for (let t = 0; t < 256; t++) {
    acc += hist[t];
    if (acc < n * 0.01) lo = t;
    if (acc < n * 0.97) hi = t;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < rgba.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((rgba[i] - lo) * 255) / span));
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
  }
}

// How big to draw the cropped receipt for reading: about 2200 px wide (small
// receipt print needs it), but never past what a phone's canvas allows.
export function readingSize(box: { w: number; h: number }): { w: number; h: number } {
  let s = 2200 / box.w;
  const maxArea = 12_000_000;
  if (box.w * s * box.h * s > maxArea) s = Math.sqrt(maxArea / (box.w * box.h));
  return { w: Math.round(box.w * s), h: Math.round(box.h * s) };
}
