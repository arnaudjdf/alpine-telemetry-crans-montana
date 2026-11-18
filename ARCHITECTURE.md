# How it works (explain-it guide)

## The 30-second pitch

> Raw wearable-logger files are messy. This project **cleans and analyses them**, reconciles them with **official timing**, and **tells the story in 3D** on real Crans-Montana terrain. Everything you see is computed from raw packets, not hard-coded.

## Data flow

```
 real world data                synthetic athletes                    analysis                          UI
┌──────────────────┐   ┌───────────────────────────────┐   ┌──────────────────────────────┐   ┌────────────────┐
│ terrain + imagery│   │ physics.ts  (truth)           │   │ parse.ts   lines -> packets   │   │ Viewer (3D)    │
│ OSM piste line   │──▶│ sensors.ts  (noise + faults)  │──▶│ clean.ts   packets -> track   │──▶│ charts, tables │
│ (fetch-data.mjs) │   │ feeds.ts    (files + timing)  │   │ metrics.ts track -> metrics   │   │ log analysis   │
└──────────────────┘   └───────────────────────────────┘   │ anomalies.ts what went wrong  │   └────────────────┘
                              writes public/data/feeds     └──────────────────────────────┘
```

The browser only sees **files**: `terrain.bin`, `texture.jpg`, `course.json`, and the NDJSON feeds. It never touches the simulator. That is the same situation as a real deployment, where the feed would come from loggers.

## Folder map

| Folder | Role | Depends on |
|---|---|---|
| `src/core` | Pure maths and geometry: `GeoFrame` (lat/lon to metres), `Terrain` (elevation sampling), `Course` (centre line, gates, projection), packet types | nothing |
| `src/sim` | Generates data: `physics` (the truth), `sensors` (noise + injected faults), `feeds` (files) | core |
| `src/analysis` | The pipeline: `parse` → `clean` → `metrics` → `anomalies`, plus `story` and `sample` | core |
| `src/app` | `AppModel` (single state + events), `loader` (fetch + run pipeline), `shell` (shortcuts, drawers, drag & drop), `exportAnalysis` | analysis |
| `src/scene` | Three.js. `Viewer` wires small parts: `terrainMesh` (winter shader), `courseLayer`, `athleteLayer` (+ `skier`, `powder`, `ribbons`), `cameraRig`, `onboard` + `onboardCams` (helmet cameras, picture-in-picture), `labelLayer`, `sky`, `venue/` (grandstands, crowd, big screen, confetti), `miniMap` | app |
| `src/ui` | DOM panels, canvas charts, one file per right-hand tab in `ui/tabs/` | app |

Rule of thumb: arrows only point **down** the table. `core` never imports `analysis`, `analysis` never imports the UI. That is why the pipeline can run in Node (tests, scripts) and in the browser unchanged.

## The pipeline in four steps

1. **Parse** (`parse.ts`): each line becomes a packet or a typed issue (malformed JSON, missing field, bad checksum). It never throws.
2. **Clean** (`clean.ts`): seven named steps. The main idea is that **time comes from the packet counter**, not the device clock, so clock drift and clock steps cannot corrupt the timeline.
   - GNSS spikes are rejected by comparing each sample with where the last accepted samples say it should be. The tolerance grows with the gap, and the validator re-locks if rejections persist.
   - Holes (dropouts, rejected samples) are filled with cubic Hermite interpolation, which respects curves better than a straight line.
3. **Metrics** (`metrics.ts`): chainage by forward-tracking projection on the course, start time from integrated Doppler speed, g-loads from the IMU, jumps where total specific force is about 0, and a **time-at-chainage curve** that gives splits, section times and gaps.
4. **Anomalies** (`anomalies.ts`): everything noteworthy as a flat, time-sorted list the UI can seek through, including GNSS vs official timing differences.

## Why you can trust it: the tests

`tests/pipeline.test.ts` generates feeds, **records every injected fault**, then checks the pipeline finds exactly those: dropouts, spikes, frozen IMU, clock step, malformed lines. It also checks GNSS split times against the official ones (within 100 ms). If you change the pipeline, this tells you immediately.

## Questions you may get

- **Why is the data synthetic?** No access to real LLAD / Swiss Timing feeds. Terrain and imagery are real; athletes come from a physics model, so ground truth is known and the pipeline can be *measured*.
- **Why not use the device timestamp?** It drifts (about 8–35 ppm here) and can step. The counter is monotonic and survives both.
- **How is the gap between two athletes computed?** Both runs are turned into "run time at every 5 m of chainage". The gap at a point is the difference of those two curves, so it is comparable even though the athletes are at different places at any given moment. The "same chainage" sync mode shows exactly this.
- **How are jumps detected?** In flight, a body is weightless: the IMU feels almost no force. Total force below 3.2 m/s² at speed above 10 m/s for at least 0.35 s.
- **What is approximate?** The course line (OpenStreetMap, not the homologated line), the gates, the three jump features and the athletes.
- **Where is the LLM?** `scripts/narrate.ts` sends the already-validated numbers to Claude and asks for captions. The model never sees raw data and is told not to invent figures. Untested without an API key.

## Reading order for a code walk-through

1. `src/analysis/pipeline.ts` (10 lines: the whole chain)
2. `src/analysis/clean.ts` (top comment, then the orchestration at the bottom)
3. `src/analysis/metrics.ts` (orchestration at the bottom)
4. `tests/pipeline.test.ts`
5. `src/app/model.ts` then `src/scene/Viewer.ts` for the front end
