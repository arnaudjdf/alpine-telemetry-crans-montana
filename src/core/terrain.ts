import type { GeoBounds } from './geo';
import { GeoFrame } from './geo';

export interface TerrainMeta extends GeoBounds {
  cols: number;
  rows: number;
  minElevation: number;
  maxElevation: number;
}

/**
 * Regular lat/lon elevation grid (north-to-south rows) exposed in local metric coordinates.
 * Pure data + sampling; mesh construction lives in the scene layer.
 */
export class Terrain {
  readonly frame: GeoFrame;
  readonly width: number;   // east-west extent, m
  readonly depth: number;   // north-south extent, m
  private readonly heights: Float32Array;

  constructor(readonly meta: TerrainMeta, raw: Uint16Array) {
    this.frame = GeoFrame.centered(meta);
    this.width = (meta.lonMax - meta.lonMin) * this.frame.mPerDegLon;
    this.depth = (meta.latMax - meta.latMin) * this.frame.mPerDegLat;
    this.heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) this.heights[i] = raw[i] / 10;   // decimetres -> metres
  }

  get cols(): number { return this.meta.cols; }
  get rows(): number { return this.meta.rows; }

  /** Elevation at grid node (i = column west->east, j = row north->south). */
  node(i: number, j: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, i)), r = Math.min(this.rows - 1, Math.max(0, j));
    return this.heights[r * this.cols + c];
  }

  /** Local x (east) of grid column i. */
  xAt(i: number): number { return -this.width / 2 + (i / (this.cols - 1)) * this.width; }
  /** Local z (south) of grid row j. */
  zAt(j: number): number { return -this.depth / 2 + (j / (this.rows - 1)) * this.depth; }

  /** Bilinear elevation at local (x, z); clamps at the edges. */
  heightAt(x: number, z: number): number {
    const fx = ((x + this.width / 2) / this.width) * (this.cols - 1);
    const fy = ((z + this.depth / 2) / this.depth) * (this.rows - 1);
    const i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j;
    return this.node(i, j) * (1 - a) * (1 - b) + this.node(i + 1, j) * a * (1 - b)
         + this.node(i, j + 1) * (1 - a) * b + this.node(i + 1, j + 1) * a * b;
  }

  /** Unit surface normal (x, y, z) from central differences. */
  normalAt(x: number, z: number): [number, number, number] {
    const e = 6;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const len = Math.hypot(dx, 1, dz);
    return [-dx / len, 1 / len, -dz / len];
  }

  /** Slope angle in degrees at (x, z). */
  slopeDegAt(x: number, z: number): number {
    return Math.acos(this.normalAt(x, z)[1]) * (180 / Math.PI);
  }
}

/** Builds a Terrain from the baked binary asset (works in the browser and in Node). */
export function terrainFromBuffers(meta: TerrainMeta, bin: ArrayBuffer): Terrain {
  return new Terrain(meta, new Uint16Array(bin));
}
