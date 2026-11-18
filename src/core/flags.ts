/**
 * National flags as a few rectangles on a 30 x 20 grid: simple enough to draw as SVG (UI) and on a canvas (3D).
 * Only simple flags are included; an unknown nation gets a neutral grey rectangle.
 */
export interface Flag { bg: string; rects: [x: number, y: number, w: number, h: number, fill: string][] }

export const FLAG_W = 30, FLAG_H = 20;

const horizontal = (...c: string[]): Flag => ({ bg: c[0], rects: c.map((fill, i) => [0, (i * FLAG_H) / c.length, FLAG_W, FLAG_H / c.length, fill]) });
const vertical = (...c: string[]): Flag => ({ bg: c[0], rects: c.map((fill, i) => [(i * FLAG_W) / c.length, 0, FLAG_W / c.length, FLAG_H, fill]) });

/** A Nordic-style cross on the vertical line x = `cx`, optionally with an inner cross of another colour. */
const cross = (bg: string, outer: string, cx: number, inner?: string): Flag => ({
  bg,
  rects: [
    [cx - 2, 0, 4, FLAG_H, outer], [0, 8, FLAG_W, 4, outer],
    ...(inner ? [[cx - 1, 0, 2, FLAG_H, inner], [0, 9, FLAG_W, 2, inner]] as Flag['rects'] : []),
  ],
});

export const FLAGS: Record<string, Flag> = {
  SUI: { bg: '#d8232a', rects: [[13, 4, 4, 12, '#ffffff'], [9, 8, 12, 4, '#ffffff']] },
  AUT: horizontal('#ed2939', '#ffffff', '#ed2939'),
  FRA: vertical('#0055a4', '#ffffff', '#ef4135'),
  ITA: vertical('#009246', '#ffffff', '#ce2b37'),
  GER: horizontal('#000000', '#dd0000', '#ffce00'),
  NOR: cross('#ba0c2f', '#ffffff', 9, '#00205b'),
  SWE: cross('#006aa7', '#fecc00', 10),
};

export const flagOf = (nation: string): Flag => FLAGS[nation] ?? { bg: '#5b6578', rects: [] };
