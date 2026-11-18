import type { RawPacket } from '../core/packet';

export type Severity = 'info' | 'warn' | 'error';

/** A single ingest problem tied to a physical line of the log file. */
export interface LogIssue {
  severity: Severity;
  code: 'MALFORMED_JSON' | 'MISSING_FIELD' | 'RANGE' | 'BAD_CRC' | 'DUPLICATE' | 'OUT_OF_ORDER';
  line: number;
  message: string;
}

export interface ParseResult {
  packets: RawPacket[];          // in file (arrival) order, structurally valid, crc-checked packets
  issues: LogIssue[];
  lines: number;
  malformed: number;
  badCrc: number;
}

export interface DropoutGap { seqStart: number; lost: number; t: number; seconds: number }
export interface SpikeEvent { t: number; samples: number; maxDisplacement: number }
export interface StuckEvent { t: number; seconds: number; channel: 'az' }
export interface ClockReport { offsetToGateway: number; driftPpm: number; steps: { t: number; seconds: number }[]; latencyP95: number }

export interface CleanReport {
  received: number;
  expected: number;
  duplicates: number;
  outOfOrder: number;
  dropouts: DropoutGap[];
  spikes: SpikeEvent[];
  stuck: StuckEvent[];
  clock: ClockReport;
  completeness: number;          // 0..1 after dedup
}

/** Uniformly resampled (20 Hz), gap-filled and smoothed sensor track. Time 0 = first packet. */
export interface CleanTrack {
  bib: number;
  src: string;
  rate: number;
  n: number;
  t: Float64Array;
  x: Float64Array; z: Float64Array; alt: Float64Array;
  spd: Float64Array;
  ax: Float64Array; ay: Float64Array; az: Float64Array;
  flags: Uint8Array;             // FLAG_* bit mask
  epoch0: number;                // device epoch of t = 0 (from the seq counter)
}

export const FLAG_FILLED = 1;    // position reconstructed over a dropout
export const FLAG_SPIKE = 2;     // GNSS sample rejected
export const FLAG_STUCK = 4;     // IMU channel frozen

export interface Jump { start: number; end: number; tTakeoff: number; airtime: number; distance: number; height: number; speedKmh: number; s: number }

export interface SplitResult {
  id: string; label: string; chainage: number;
  gnssTime: number;              // s since start, from the cleaned track
  officialTime?: number;
  officialStatus?: string;
  delta?: number;                // gnss - official, s
}

export interface SectionResult { from: string; to: string; time: number; avgKmh: number; maxKmh: number; avgGLat: number }

/** Per-sample derived series on the run-time axis (0 = start). */
export interface RunSeries {
  n: number;
  t: Float64Array;              // run time, s (negative before the start)
  s: Float64Array;              // chainage, m
  lateral: Float64Array;        // offset from the centre line, m (+ right)
  x: Float64Array; y: Float64Array; z: Float64Array;
  v: Float64Array;              // m/s, 3D path speed
  vDoppler: Float64Array;       // m/s, as reported by the logger (horizontal)
  slope: Float64Array;          // deg, positive downhill
  heading: Float64Array;        // rad clockwise from north
  gLat: Float64Array;           // g, + toward the right
  gLong: Float64Array;
  gVert: Float64Array;
  air: Uint8Array;
  flags: Uint8Array;
}

export interface RunSummary {
  runTime: number;
  topSpeedKmh: number; topSpeedAt: number;
  avgKmh: number;
  maxGLat: number; maxGVert: number;
  lineRms: number;
  airtime: number;
  speedResidual: number;        // RMS(GNSS Doppler - derived) in m/s; a data-quality indicator
}

export interface Anomaly {
  id: string;
  bib: number;
  kind: 'dropout' | 'gnss_spike' | 'stuck_imu' | 'clock_step' | 'timing' | 'jump' | 'high_g' | 'transport';
  severity: Severity;
  t: number;                    // run time, s
  s: number;                    // chainage, m
  message: string;
}

export interface RunAnalysis {
  bib: number;
  parse: ParseResult;
  report: CleanReport;
  series: RunSeries;
  splits: SplitResult[];
  sections: SectionResult[];
  jumps: Jump[];
  summary: RunSummary;
  sGrid: Float64Array;          // chainage grid (5 m)
  tAt: Float64Array;            // run time at each grid chainage
  anomalies: Anomaly[];
  t0: number;                   // start offset in cleaned-track time, s
}
