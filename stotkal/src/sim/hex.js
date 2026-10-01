// Axial hex coordinates (q, r). Pointy-top layout in the renderer.
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const key = (q, r) => q + ',' + r;
export const parse = (k) => { const [q, r] = k.split(',').map(Number); return { q, r }; };
export const dist = (a, b) => {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
export const neighbors = (q, r) => DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
export function inRadius(R) {
  const out = [];
  for (let q = -R; q <= R; q++) for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) out.push({ q, r });
  return out;
}
export const ring = (c, n) => inRadius(n).filter(h => dist({ q: 0, r: 0 }, h) === n).map(h => ({ q: c.q + h.q, r: c.r + h.r }));
export const within = (c, n) => inRadius(n).map(h => ({ q: c.q + h.q, r: c.r + h.r }));
