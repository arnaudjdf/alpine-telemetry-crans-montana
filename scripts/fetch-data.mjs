// Downloads and bakes the real-world data used by the app:
//   - elevation: AWS "Terrain Tiles" (terrarium encoding)       -> public/data/terrain.bin + terrain.json
//   - imagery:   swisstopo SWISSIMAGE WMTS (open government data) -> public/data/texture.jpg
//   - pistes:    OpenStreetMap downhill ways via Overpass          -> data/raw/pistes.json (cached)
// Everything is resampled onto one regular lat/lon grid so the 3D plane can use linear UVs.
// Usage: node scripts/fetch-data.mjs
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Area of interest (degrees). Covers Cry d'Er, Mont-Lachaux, Les Barzettes and Montana village. */
const BOUNDS = { latMin: 46.300, latMax: 46.350, lonMin: 7.455, lonMax: 7.520 };
const ELEV_Z = 14;       // ~6.6 m/px at this latitude
const IMG_Z = 16;        // ~1.65 m/px
const GRID = { cols: 650, rows: 700 };
const TEX = { w: 3072, h: 3392 };
const COURSE_OSM_ID = 208126913;
const UA = 'alpine-telemetry-data-script/1.0';

const RAW = 'data/raw', OUT = 'public/data';
await mkdir(`${RAW}/tiles`, { recursive: true });
await mkdir(OUT, { recursive: true });

const exists = (p) => access(p).then(() => true, () => false);
const lonToX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function getBytes(url, cacheFile) {
  if (cacheFile && (await exists(cacheFile))) return readFile(cacheFile);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (cacheFile) await writeFile(cacheFile, buf);
      return buf;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

/** Downloads every tile covering BOUNDS and returns a raw RGB(A) mosaic. */
async function buildMosaic(kind, z, urlFor, channels) {
  const x0 = Math.floor(lonToX(BOUNDS.lonMin, z)), x1 = Math.floor(lonToX(BOUNDS.lonMax, z));
  const y0 = Math.floor(latToY(BOUNDS.latMax, z)), y1 = Math.floor(latToY(BOUNDS.latMin, z));
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, W = nx * 256, H = ny * 256;
  console.log(`[${kind}] z${z}: ${nx}x${ny} tiles`);
  const mosaic = Buffer.alloc(W * H * channels);
  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [tx, ty] = jobs[next++];
      const bytes = await getBytes(urlFor(z, tx, ty), `${RAW}/tiles/${kind}_${z}_${tx}_${ty}`);
      const { data } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let row = 0; row < 256; row++) {
        const dst = ((ty - y0) * 256 + row) * W * channels + (tx - x0) * 256 * channels;
        data.copy(mosaic, dst, row * 256 * 3, row * 256 * 3 + 256 * channels);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { mosaic, W, H, x0, y0 };
}

/* ---------- elevation ---------- */
{
  const { mosaic, W, H, x0, y0 } = await buildMosaic(
    'terrarium', ELEV_Z, (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, 3);
  const elev = (px, py) => {
    const ix = Math.min(W - 1, Math.max(0, px)), iy = Math.min(H - 1, Math.max(0, py));
    const o = (iy * W + ix) * 3;
    return mosaic[o] * 256 + mosaic[o + 1] + mosaic[o + 2] / 256 - 32768;
  };
  const { cols, rows } = GRID;
  const out = new Uint16Array(cols * rows);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < rows; j++) {
    const lat = BOUNDS.latMax - (j / (rows - 1)) * (BOUNDS.latMax - BOUNDS.latMin);
    const py = (latToY(lat, ELEV_Z) - y0) * 256;
    for (let i = 0; i < cols; i++) {
      const lon = BOUNDS.lonMin + (i / (cols - 1)) * (BOUNDS.lonMax - BOUNDS.lonMin);
      const px = (lonToX(lon, ELEV_Z) - x0) * 256;
      const fx = Math.floor(px), fy = Math.floor(py), ax = px - fx, ay = py - fy;
      const h = elev(fx, fy) * (1 - ax) * (1 - ay) + elev(fx + 1, fy) * ax * (1 - ay)
              + elev(fx, fy + 1) * (1 - ax) * ay + elev(fx + 1, fy + 1) * ax * ay;
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      out[j * cols + i] = Math.round(h * 10);   // decimetres
    }
  }
  await writeFile(`${OUT}/terrain.bin`, Buffer.from(out.buffer));
  await writeFile(`${OUT}/terrain.json`, JSON.stringify({
    ...BOUNDS, ...GRID, unit: 'decimetre', encoding: 'uint16-le row-major, north to south',
    minElevation: lo, maxElevation: hi,
    sources: ['AWS Terrain Tiles (terrarium)', 'swisstopo SWISSIMAGE', 'OpenStreetMap contributors (ODbL)'],
  }, null, 2));
  console.log(`[elevation] ${cols}x${rows}, ${lo.toFixed(0)}..${hi.toFixed(0)} m`);
}

/* ---------- imagery ---------- */
{
  const { mosaic, W, H, x0, y0 } = await buildMosaic(
    'swissimage', IMG_Z,
    (z, x, y) => `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg`, 3);
  const out = Buffer.alloc(TEX.w * TEX.h * 3);
  for (let j = 0; j < TEX.h; j++) {
    const lat = BOUNDS.latMax - (j / (TEX.h - 1)) * (BOUNDS.latMax - BOUNDS.latMin);
    const py = (latToY(lat, IMG_Z) - y0) * 256;
    const fy = Math.min(H - 2, Math.max(0, Math.floor(py))), ay = Math.min(1, Math.max(0, py - fy));
    for (let i = 0; i < TEX.w; i++) {
      const lon = BOUNDS.lonMin + (i / (TEX.w - 1)) * (BOUNDS.lonMax - BOUNDS.lonMin);
      const px = (lonToX(lon, IMG_Z) - x0) * 256;
      const fx = Math.min(W - 2, Math.max(0, Math.floor(px))), ax = Math.min(1, Math.max(0, px - fx));
      for (let c = 0; c < 3; c++) {
        const a = mosaic[(fy * W + fx) * 3 + c], b = mosaic[(fy * W + fx + 1) * 3 + c];
        const d = mosaic[((fy + 1) * W + fx) * 3 + c], e = mosaic[((fy + 1) * W + fx + 1) * 3 + c];
        out[(j * TEX.w + i) * 3 + c] = a * (1 - ax) * (1 - ay) + b * ax * (1 - ay) + d * (1 - ax) * ay + e * ax * ay;
      }
    }
  }
  await sharp(out, { raw: { width: TEX.w, height: TEX.h, channels: 3 } }).jpeg({ quality: 82, mozjpeg: true })
    .toFile(`${OUT}/texture.jpg`);
  console.log('[imagery] texture.jpg written');
}

/* ---------- pistes (OpenStreetMap) ---------- */
{
  const file = `${RAW}/pistes.json`;
  if (!(await exists(file))) {
    const q = `[out:json][timeout:60];way["piste:type"="downhill"](${BOUNDS.latMin},${BOUNDS.lonMin},${BOUNDS.latMax},${BOUNDS.lonMax});out tags geom;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: q }),
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const osm = JSON.parse(await readFile(file, 'utf8'));
  const pistes = osm.elements.filter((e) => e.geometry).map((e) => ({
    id: e.id, name: e.tags['piste:name'] ?? e.tags.name ?? '', difficulty: e.tags['piste:difficulty'] ?? '',
    pts: e.geometry.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)]),
  }));
  await writeFile(`${OUT}/pistes.json`, JSON.stringify(pistes));
  // The racing course: OSM way "Piste Nationale" (approximate geometry, NOT the official homologated line).
  const course = pistes.find((p) => p.id === COURSE_OSM_ID);
  if (!course) throw new Error(`course way ${COURSE_OSM_ID} not found`);
  await writeFile(`${OUT}/course.json`, JSON.stringify({
    name: 'Piste Nationale', osmId: COURSE_OSM_ID,
    note: 'Geometry from OpenStreetMap; approximate, not the official FIS homologated course.', pts: course.pts,
  }));
  console.log(`[pistes] ${pistes.length} ways`);
}
console.log('done');
