import './style.css';
import { AppModel } from './app/model';
import { loadWorld, withUserLogs } from './app/loader';
import { exportAnalysis } from './app/exportAnalysis';
import { bindDrawers, bindDropZone, bindShortcuts } from './app/shell';
import { Viewer } from './scene/Viewer';
import { mountAboutPanel } from './ui/aboutPanel';
import { mountControlPanel } from './ui/controlPanel';
import { mountRightPanel } from './ui/rightPanel';
import { mountStandings } from './ui/standings';
import { mountHud, mountStatusBar, mountTransport } from './ui/transport';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const model = new AppModel();

let toastTimer = 0;
function toast(message: string, ms = 4200): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

/** Re-runs the whole pipeline on files the user dropped or picked. */
async function analyseUserFiles(files: File[]): Promise<void> {
  try {
    const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
    const next = withUserLogs(model.world, texts.filter((t) => t.text.trim()));
    if (!next.runs.length) throw new Error('No valid runs found');
    model.setWorld(next);
    toast(`Analysed ${next.runs.length} log${next.runs.length > 1 ? 's' : ''} in ${next.pipelineMs.toFixed(0)} ms`);
  } catch (e) {
    toast(`Could not analyse the file: ${(e as Error).message}`);
  }
}

function showCourseInfo(): void {
  const { course } = model.world;
  $('courseinfo').innerHTML = `<b>${course.name}</b> · ${Math.round(course.length).toLocaleString()} m · ↓${Math.round(course.verticalDrop)} m · ${course.gates.length} gates <small>(OSM geometry, approx.)</small>`;
}

async function boot(): Promise<void> {
  const status = $('loadmsg');
  try {
    // 1. data + pipeline  2. 3D scene  3. UI panels  4. interaction
    const world = await loadWorld((message) => { status.textContent = message; });
    model.setWorld(world);
    showCourseInfo();

    status.textContent = 'Building 3D scene…';
    const viewer = new Viewer($('viewport'), model);
    await viewer.build();

    mountControlPanel($('left'), model, {
      onFiles: analyseUserFiles, onExport: () => exportAnalysis(model), onOverview: () => viewer.overview(),
      onReset: () => { model.setWorld(world); toast('Demo data restored'); },
    });
    mountRightPanel($('right'), model);
    mountTransport($('transport'), model);
    mountHud($('overlay'), model);
    mountStandings($('overlay'), model);
    mountStatusBar($('status'), model, viewer);
    mountAboutPanel($('app'), model, $('btn-about'));

    bindShortcuts(model);
    bindDrawers($('app'), $('btn-left'), $('btn-right'), $('scrim'));
    bindDropZone($('dropzone'), analyseUserFiles);

    viewer.start();
    $('loading').classList.add('done');
    const packets = world.runs.reduce((sum, r) => sum + r.report.received, 0);
    toast(`Loaded ${world.runs.length} loggers · ${packets.toLocaleString()} packets analysed in ${world.pipelineMs.toFixed(0)} ms`);
  } catch (e) {
    console.error(e);
    status.textContent = `Failed to start: ${(e as Error).message}`;
    $('loading').classList.add('error');
  }
}

boot();
