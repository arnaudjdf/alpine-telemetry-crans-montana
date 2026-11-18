# Alpine Telemetry · Crans-Montana

A mission-control style web console for an alpine downhill: a 3D replay on **real Crans-Montana terrain**, live-looking telemetry, and a **raw-log analysis pipeline** that ingests messy logger feeds and reconciles them against official timing.

> **Concept demo.** Athlete data is synthetic (physics simulation on real terrain). The course geometry comes from OpenStreetMap ("Piste Nationale"), not the official homologated line. Gates and the three jumps are synthetic.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # pipeline tests (fault detection, timing reconciliation)
npm run build        # static site in dist/
```

Baked data is committed in `public/data`. To regenerate it:

```bash
npm run data:fetch   # terrain, aerial imagery, OSM pistes (network)
npm run data:feeds   # synthetic logger feeds + official timing CSV
```

## What it does

| Layer | Where | Notes |
|---|---|---|
| Real terrain | `scripts/fetch-data.mjs`, `src/scene/terrainMesh.ts` | AWS terrain tiles + swisstopo SWISSIMAGE on one lat/lon grid. A shader derives winter snow from altitude, slope and vegetation. |
| Physics simulator | `src/sim/physics.ts` | Gravity, friction, quadratic drag, edge losses, ballistic flight over crests. |
| Faulty feeds | `src/sim/sensors.ts` | Dropouts, GNSS spikes, frozen IMU, duplicates, re-ordering, bad checksums, truncated lines, clock drift and a clock step. |
| Ingest and cleaning | `src/analysis/parse.ts`, `clean.ts` | Time rebuilt from the packet counter; spike rejection with re-acquisition; Hermite gap fill. |
| Metrics | `src/analysis/metrics.ts` | Chainage, splits, g-loads, jump detection, section times, time-at-chainage curves. |
| Reconciliation | `src/analysis/anomalies.ts` | GNSS splits vs photocell export; flags the missed beam. |
| Console UI | `src/ui/*` | Telemetry charts, splits, log analysis (quality timeline, events, console), responsive drawers. |

Every injected fault is recorded, and `tests/pipeline.test.ts` checks that the pipeline finds each one. GNSS split times land within about 40 ms of the official ones.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data flow, folder map and a code walk-through guide.

## Using your own data

Drop NDJSON files onto the page (one per athlete, same packet shape as `public/data/feeds/bib07.ndjson`). The pipeline re-runs in the browser.

## Controls

The "How it's built" panel has its own address: `/#about` (also `i` or `?`). Share that link to open it directly.

`Space` play/pause · `←/→` ±1 s (`Shift` ±5 s) · `1–5` cameras (chase, TV, heli, onboard, free) · `[` `]` rate · `F` next athlete · `R` restart. Click any chart to seek.

## Known limits

- Course line is approximate; replace `public/data/course.json` with an official one.
- The pipeline runs on the main thread (about 120 ms for 4 runs); a worker would be the next step for large feeds.
- Imagery is summer; the winter look is synthesised.

Data: swisstopo, AWS Terrain Tiles, © OpenStreetMap contributors (ODbL).
