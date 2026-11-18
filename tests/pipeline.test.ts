import { describe, expect, it, beforeAll } from 'vitest';
import { loadWorld } from '../scripts/lib/load';
import { analyzeAthlete } from '../src/analysis/pipeline';
import { generateFeeds, type GeneratedFeeds } from '../src/sim/feeds';
import { parseTimingCsv } from '../src/analysis/parse';

let world: ReturnType<typeof loadWorld>;
let feeds: GeneratedFeeds;
beforeAll(() => { world = loadWorld(); feeds = generateFeeds(world.course); }, 60000);

describe('course', () => {
  it('is a real-scale downhill', () => {
    expect(world.course.length).toBeGreaterThan(2800);
    expect(world.course.verticalDrop).toBeGreaterThan(600);
    expect(world.course.gates.length).toBeGreaterThan(40);
  });
  it('projects points back onto the centre line', () => {
    const p = world.course.pointAt(1500, 5);
    const pr = world.course.project(p.x, p.z);
    expect(pr.s).toBeCloseTo(1500, -0.5);
    expect(pr.lateral).toBeCloseTo(5, 0);
  });
});

describe('analysis pipeline', () => {
  it('recovers official split times within 100 ms for clean timing points', () => {
    const timing = parseTimingCsv(feeds.files['timing.csv']);
    for (const bib of [7, 12, 21]) {
      const a = analyzeAthlete(feeds.files[`bib${String(bib).padStart(2, '0')}.ndjson`], world.course, timing);
      for (const sp of a.splits.filter((s) => s.id !== 'START')) expect(Math.abs(sp.delta!)).toBeLessThan(0.1);
    }
  });

  it('detects every injected transport / sensor fault', () => {
    const timing = parseTimingCsv(feeds.files['timing.csv']);
    for (const bib of [7, 12, 21, 33]) {
      const a = analyzeAthlete(feeds.files[`bib${String(bib).padStart(2, '0')}.ndjson`], world.course, timing);
      const inj = feeds.faults.filter((f) => f.bib === bib);
      expect(a.report.dropouts.length).toBe(inj.filter((f) => f.kind === 'dropout').length);
      expect(a.report.spikes.length).toBe(inj.filter((f) => f.kind === 'gnss_spike').length);
      expect(a.report.stuck.length).toBe(inj.filter((f) => f.kind === 'stuck_imu').length);
      expect(a.report.clock.steps.length).toBe(inj.filter((f) => f.kind === 'clock_step').length);
      expect(a.parse.malformed).toBe(inj.filter((f) => f.kind === 'malformed').length);
    }
  });

  it('flags the missed photocell as a timing discrepancy', () => {
    const timing = parseTimingCsv(feeds.files['timing.csv']);
    const a = analyzeAthlete(feeds.files['bib33.ndjson'], world.course, timing);
    expect(a.anomalies.some((x) => x.kind === 'timing' && x.message.includes('ESTIMATED'))).toBe(true);
  });

  it('finds the course features as jumps and keeps loads physical', () => {
    const a = analyzeAthlete(feeds.files['bib07.ndjson'], world.course);
    expect(a.jumps.length).toBeGreaterThanOrEqual(3);
    expect(a.summary.topSpeedKmh).toBeGreaterThan(110);
    expect(a.summary.topSpeedKmh).toBeLessThan(160);
    expect(a.summary.maxGLat).toBeLessThan(5);
  });
});
