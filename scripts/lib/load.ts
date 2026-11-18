import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildCourse, type RawCourse } from '../../src/core/course';
import { terrainFromBuffers, type TerrainMeta } from '../../src/core/terrain';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const dataPath = (...p: string[]) => path.join(ROOT, 'public/data', ...p);

/** Loads the baked terrain + course from disk (Node counterpart of the browser loader). */
export function loadWorld() {
  const meta = JSON.parse(readFileSync(dataPath('terrain.json'), 'utf8')) as TerrainMeta;
  const bin = readFileSync(dataPath('terrain.bin'));
  const terrain = terrainFromBuffers(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer);
  const raw = JSON.parse(readFileSync(dataPath('course.json'), 'utf8')) as RawCourse;
  return { terrain, course: buildCourse(raw, terrain) };
}
