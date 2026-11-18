import { FLAG_H, FLAG_W, flagOf } from '../core/flags';

/** Inline SVG markup of a flag (for innerHTML). `height` in px; the width follows the 3:2 ratio. */
export function flagMarkup(nation: string, height = 12): string {
  const flag = flagOf(nation), rects = flag.rects.map(([x, y, w, h, fill]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join('');
  return `<svg class="flag" viewBox="0 0 ${FLAG_W} ${FLAG_H}" width="${Math.round((height * FLAG_W) / FLAG_H)}" height="${height}" role="img" aria-label="${nation}">`
    + `<rect width="${FLAG_W}" height="${FLAG_H}" fill="${flag.bg}"/>${rects}</svg>`;
}

/** A flag as a DOM element. */
export function flagElement(nation: string, height = 12): HTMLElement {
  const span = document.createElement('span');
  span.className = 'flag-wrap';
  span.innerHTML = flagMarkup(nation, height);
  return span;
}

/** Draws a flag into the rectangle (x, y, w, h) of a 2D canvas context. */
export function drawFlag(g: CanvasRenderingContext2D, nation: string, x: number, y: number, w: number, h: number): void {
  const flag = flagOf(nation), sx = w / FLAG_W, sy = h / FLAG_H;
  g.fillStyle = flag.bg;
  g.fillRect(x, y, w, h);
  for (const [rx, ry, rw, rh, fill] of flag.rects) { g.fillStyle = fill; g.fillRect(x + rx * sx, y + ry * sy, rw * sx, rh * sy); }
}
