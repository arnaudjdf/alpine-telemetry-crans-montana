import type { Course } from '../core/course';
import type { TimingEvent } from '../core/packet';
import { detectAnomalies } from './anomalies';
import { cleanPackets } from './clean';
import { computeMetrics } from './metrics';
import { parseFeed } from './parse';
import type { RunAnalysis } from './types';

/** Full ingest -> clean -> analyse chain for one athlete's raw log. Throws only if nothing usable was found. */
export function analyzeAthlete(text: string, course: Course, timing: TimingEvent[] = []): RunAnalysis {
  const parse = parseFeed(text);
  if (!parse.packets.length) throw new Error('No valid packets found in the log');
  const { track, report } = cleanPackets(parse.packets, course.terrain.frame);
  const official = timing.filter((e) => e.bib === track.bib);
  const metrics = computeMetrics(track, course, official);
  const anomalies = detectAnomalies(track.bib, parse, report, metrics);
  return { bib: track.bib, parse, report, anomalies, ...metrics };
}
