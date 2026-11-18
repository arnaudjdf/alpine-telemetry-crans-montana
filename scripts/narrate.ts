// Optional LLM step: turns the pipeline's analysis into broadcast-style captions.
// The model only sees compact, already-validated numbers and must not invent any.
// Usage: ANTHROPIC_API_KEY=... npm run data:narrate      (add --dry-run to print the prompt only)
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeAthlete } from '../src/analysis/pipeline';
import { parseTimingCsv } from '../src/analysis/parse';
import type { FeedManifest } from '../src/core/packet';
import { dataPath, loadWorld } from './lib/load';

const MODEL = 'claude-sonnet-5-5';
const { course } = loadWorld();
const manifest = JSON.parse(readFileSync(dataPath('feeds/manifest.json'), 'utf8')) as FeedManifest;
const timing = parseTimingCsv(readFileSync(dataPath('feeds', manifest.timingFile), 'utf8'));
const runs = manifest.athletes.map((a) => ({ a, r: analyzeAthlete(readFileSync(dataPath('feeds', a.file), 'utf8'), course, timing) }));

const facts = runs.map(({ a, r }) => ({
  athlete: `${a.nation} ${a.bib}`, runTime: +r.summary.runTime.toFixed(2), topSpeedKmh: Math.round(r.summary.topSpeedKmh),
  maxLateralG: +r.summary.maxGLat.toFixed(1), jumps: r.jumps.map((j) => ({ distanceM: Math.round(j.distance), airtimeS: +j.airtime.toFixed(2) })),
  splits: r.splits.slice(1).map((s) => ({ point: s.label, t: +s.gnssTime.toFixed(2) })),
}));
const prompt = `You write short captions for a ski-race TV graphic (Longines style). Use ONLY the facts below; never invent numbers.
Return JSON: {"captions":[{"title":string,"body":string}]} with 5 captions, each body under 25 words.
Course: ${course.name}, ${Math.round(course.length)} m, ${Math.round(course.verticalDrop)} m drop. Data is synthetic.
Facts: ${JSON.stringify(facts)}`;

if (process.argv.includes('--dry-run')) { console.log(prompt); process.exit(0); }
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('Set ANTHROPIC_API_KEY (or use --dry-run).'); process.exit(1); }

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
});
if (!res.ok) { console.error(`API error ${res.status}: ${await res.text()}`); process.exit(1); }
const text = ((await res.json()) as { content: { text: string }[] }).content[0].text;
const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
writeFileSync(dataPath('narration.json'), JSON.stringify({ model: MODEL, generated: new Date().toISOString(), ...json }, null, 2));
console.log(`wrote narration.json (${json.captions.length} captions)`);
