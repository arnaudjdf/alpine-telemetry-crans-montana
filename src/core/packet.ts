import { fnv1a } from './math';

/** One packet of the (synthetic) wearable logger stream. Mirrors a typical GNSS+IMU pod: ~20 Hz, JSON lines. */
export interface RawPacket {
  src: string;       // logger id
  bib: number;
  seq: number;       // device packet counter (monotonic, survives dropouts)
  ts: number;        // device clock, epoch seconds
  rx: number;        // gateway receive time, epoch seconds
  lat: number;
  lon: number;
  alt: number;       // m, antenna height included
  spd: number;       // GNSS Doppler ground speed, m/s
  hdop: number;
  nsat: number;
  ax: number;        // body frame specific force (m/s^2): x forward, y left, z up
  ay: number;
  az: number;
  crc: string;
}

export const SAMPLE_RATE = 20;   // Hz

export const PACKET_FIELDS = ['src', 'bib', 'seq', 'ts', 'rx', 'lat', 'lon', 'alt', 'spd', 'hdop', 'nsat', 'ax', 'ay', 'az', 'crc'] as const;

export function packetChecksum(p: Omit<RawPacket, 'crc'>): string {
  return fnv1a(`${p.src}|${p.bib}|${p.seq}|${p.ts}|${p.lat}|${p.lon}|${p.alt}|${p.spd}|${p.ax}|${p.ay}|${p.az}`);
}

export interface TimingEvent {
  bib: number;
  point: string;        // START | SPLITn | FINISH
  chainage: number;     // m
  time: number;         // s since start
  status: string;       // OK | ESTIMATED | MISSED
}

export interface AthleteInfo {
  bib: number;
  name: string;
  nation: string;
  color: string;
  src: string;
  file: string;
  startEpoch: number;
}

export interface FeedManifest {
  event: string;
  date: string;
  course: string;
  disclaimer: string;
  athletes: AthleteInfo[];
  timingFile: string;
  sampleRate: number;
}
