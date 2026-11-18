/** Small numeric helpers shared by the simulator, the analysis pipeline and the renderer. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;

/** Wraps an angle to (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

/** Deterministic PRNG (mulberry32) so generated feeds are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample from a uniform RNG (Box-Muller). */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Linear interpolation of y(x) for monotonically increasing xs; clamps outside the domain. */
export function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m; else hi = m;
  }
  const span = xs[hi] - xs[lo];
  return span === 0 ? ys[lo] : lerp(ys[lo], ys[hi], (x - xs[lo]) / span);
}

/** Index i such that xs[i] <= x < xs[i+1] (clamped to [0, n-2]). */
export function bracket(xs: ArrayLike<number>, x: number): number {
  let lo = 0, hi = xs.length - 1;
  if (x <= xs[0]) return 0;
  if (x >= xs[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m; else hi = m;
  }
  return lo;
}

/** Gaussian smoothing of a uniformly sampled series (sigma in samples). Edges are mirrored. */
export function gaussianSmooth(src: ArrayLike<number>, sigma: number): Float64Array {
  const n = src.length, out = new Float64Array(n);
  if (sigma <= 0 || n === 0) { for (let i = 0; i < n; i++) out[i] = src[i]; return out; }
  const r = Math.ceil(sigma * 3);
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const at = (i: number) => src[i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i] ?? src[clamp(i, 0, n - 1)];
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += k[j + r] * at(i + j);
    out[i] = acc;
  }
  return out;
}

/** Median of a numeric array (does not mutate). */
export function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((p, q) => p - q);
  const n = a.length;
  if (!n) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** Fast 32-bit FNV-1a, hex encoded to 8 chars; used as the packet checksum. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const G = 9.80665;
