// Generates the synthetic raw logger feeds + official timing CSV into public/data/feeds.
// Usage: npm run data:feeds
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateFeeds } from '../src/sim/feeds';
import { dataPath, loadWorld } from './lib/load';

const { course } = loadWorld();
const feeds = generateFeeds(course);
const dir = dataPath('feeds');
mkdirSync(dir, { recursive: true });
for (const [name, body] of Object.entries(feeds.files)) writeFileSync(`${dir}/${name}`, body);

console.log(`course ${course.name}: ${course.length.toFixed(0)} m, drop ${course.verticalDrop.toFixed(0)} m, ${course.gates.length} gates`);
for (const e of feeds.timing.filter((t) => t.point === 'FINISH')) {
  const run = feeds.truth[e.bib];
  let vmax = 0, air = 0; run.v.forEach((v, i) => { if (v > vmax) vmax = v; air += run.air[i]; });
  console.log(`bib ${e.bib}: ${e.time.toFixed(2)} s, vmax ${(vmax * 3.6).toFixed(0)} km/h, avg ${(course.length / e.time * 3.6).toFixed(0)} km/h, air ${(air * run.dt).toFixed(1)} s`);
}
console.log(`faults injected: ${feeds.faults.length}`);
