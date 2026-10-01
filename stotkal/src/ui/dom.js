export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const RES_META = { sus: { n: 'Sustenance', i: '❀', c: 'sus' }, mat: { n: 'Matter', i: '◆', c: 'mat' }, ene: { n: 'Energy', i: '⚡', c: 'ene' }, mem: { n: 'Memory', i: '◈', c: 'mem' } };
export const costHtml = (c, have) => {
  const parts = Object.entries(c || {}).filter(([k, v]) => v).map(([k, v]) => `<span class="cost r-${k} ${have && have[k] < v ? 'short' : ''}" title="${RES_META[k].n}"><b>${RES_META[k].i}</b>${v}</span>`);
  return parts.length ? parts.join('') : '<span class="cost free">no cost</span>';
};
export const sign = (n) => (n > 0 ? '+' : '') + n;
export const pct = (x) => Math.round(x * 100) + '%';
export function toast(msg, kind = 'info') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.setAttribute('role', 'status'); t.textContent = msg;
  const host = document.getElementById('toasts'); host.appendChild(t); setTimeout(() => t.classList.add('out'), 2400); setTimeout(() => t.remove(), 2900); while (host.children.length > 3) host.firstChild.remove();
}
