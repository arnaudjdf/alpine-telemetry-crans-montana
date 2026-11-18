import { PACKET_FIELDS, type RawPacket, type TimingEvent, packetChecksum } from '../core/packet';
import type { LogIssue, ParseResult } from './types';

const NUMERIC = PACKET_FIELDS.filter((f) => f !== 'src' && f !== 'crc');

/** Parses an NDJSON logger file. Never throws: every problem becomes a LogIssue. */
export function parseFeed(text: string): ParseResult {
  const issues: LogIssue[] = [];
  const packets: RawPacket[] = [];
  const rows = text.split('\n');
  let lines = 0, malformed = 0, badCrc = 0;
  rows.forEach((row, idx) => {
    const line = idx + 1;
    if (!row.trim()) return;
    lines++;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(row); } catch {
      malformed++;
      issues.push({ severity: 'warn', code: 'MALFORMED_JSON', line, message: `Line ${line}: truncated or invalid JSON (${row.length} bytes)` });
      return;
    }
    const missing = PACKET_FIELDS.filter((f) => !(f in obj));
    const bad = NUMERIC.filter((f) => f in obj && !Number.isFinite(obj[f] as number));
    if (missing.length || bad.length || typeof obj.src !== 'string') {
      malformed++;
      issues.push({ severity: 'warn', code: 'MISSING_FIELD', line, message: `Line ${line}: missing/invalid fields ${[...missing, ...bad].join(', ')}` });
      return;
    }
    const p = obj as unknown as RawPacket;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || p.nsat < 0 || p.hdop < 0) {
      malformed++;
      issues.push({ severity: 'warn', code: 'RANGE', line, message: `Line ${line}: value out of physical range (seq ${p.seq})` });
      return;
    }
    if (packetChecksum(p) !== p.crc) {
      badCrc++;
      issues.push({ severity: 'warn', code: 'BAD_CRC', line, message: `Line ${line}: checksum mismatch, packet ${p.seq} discarded` });
      return;
    }
    packets.push(p);
  });
  return { packets, issues, lines, malformed, badCrc };
}

/** Parses the official timing export (CSV with header). */
export function parseTimingCsv(text: string): TimingEvent[] {
  const [head, ...rows] = text.trim().split('\n');
  const cols = head.split(',').map((c) => c.trim());
  const col = (name: string) => cols.indexOf(name);
  const ib = col('bib'), ip = col('point'), ic = col('chainage_m'), it = col('time_s'), is = col('status');
  return rows.filter(Boolean).map((r) => {
    const f = r.split(',');
    return { bib: Number(f[ib]), point: f[ip], chainage: Number(f[ic]), time: Number(f[it]), status: f[is] };
  });
}
