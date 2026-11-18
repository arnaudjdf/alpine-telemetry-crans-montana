type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Minimal hyperscript helper: h('div', { class: 'x', onclick: fn }, child, ...). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== false && c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const fmtTime = (s: number, d = 2): string => {
  const sign = s < 0 ? '−' : '', a = Math.abs(s), m = Math.floor(a / 60);
  return `${sign}${m > 0 ? `${m}:` : ''}${(a - m * 60).toFixed(d).padStart(m > 0 ? d + 3 : 0, '0')}`;
};
export const fmtSigned = (v: number, d = 2): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
