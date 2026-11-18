import type { AppModel } from './model';

/** Downloads the full analysis (summaries, splits, jumps, ingest report, anomalies, story) as JSON. */
export function exportAnalysis(model: AppModel): void {
  const { world } = model;
  const payload = {
    generated: new Date().toISOString(),
    course: { name: world.course.name, length: world.course.length, verticalDrop: world.course.verticalDrop, timing: world.course.timing },
    runs: world.runs.map((run) => ({
      bib: run.bib, summary: run.summary, splits: run.splits, sections: run.sections, jumps: run.jumps,
      ingest: { lines: run.parse.lines, malformed: run.parse.malformed, badCrc: run.parse.badCrc, ...run.report },
      anomalies: run.anomalies,
    })),
    insights: world.insights,
  };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  link.download = 'alpine-telemetry-analysis.json';
  link.click();
  URL.revokeObjectURL(link.href);
}
