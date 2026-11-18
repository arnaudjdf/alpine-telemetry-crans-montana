/**
 * Local tangent-plane frame around a fixed origin.
 * Axes follow three.js conventions: +x = east, +y = up, +z = south (north is -z).
 */
import { DEG } from './math';

export interface GeoBounds { latMin: number; latMax: number; lonMin: number; lonMax: number }

export class GeoFrame {
  readonly mPerDegLat: number;
  readonly mPerDegLon: number;

  constructor(readonly lat0: number, readonly lon0: number) {
    const p = lat0 * DEG;
    // WGS84 series for metres per degree (accurate to well under a metre across a few km).
    this.mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
    this.mPerDegLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  }

  static centered(b: GeoBounds): GeoFrame {
    return new GeoFrame((b.latMin + b.latMax) / 2, (b.lonMin + b.lonMax) / 2);
  }

  toLocal(lat: number, lon: number): { x: number; z: number } {
    return { x: (lon - this.lon0) * this.mPerDegLon, z: -(lat - this.lat0) * this.mPerDegLat };
  }

  toGeo(x: number, z: number): { lat: number; lon: number } {
    return { lat: this.lat0 - z / this.mPerDegLat, lon: this.lon0 + x / this.mPerDegLon };
  }
}
