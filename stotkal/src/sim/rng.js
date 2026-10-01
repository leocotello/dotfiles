// Deterministic RNG. State lives inside the run state (S.rng) so save/load never rerolls anything.
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function mulberry(seed) { // returns a standalone generator (used for map generation)
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.state = () => a;
  return f;
}
export function rnd(S) { // advances S.rng
  S.rng = (S.rng + 0x6D2B79F5) >>> 0;
  let t = S.rng; t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rint = (S, n) => Math.floor(rnd(S) * n);
export const pickOne = (S, arr) => arr[rint(S, arr.length)];
// Stable, order-independent pseudo-random in [0,1) from strings: used for initiative & AI jitter so that
// results do not depend on how many other random numbers were drawn.
export const stable = (seed, ...parts) => mulberry(hashStr(seed + '|' + parts.join('|')))();
export function weightedPick(S, items, wf) {
  const ws = items.map(wf); const tot = ws.reduce((a, b) => a + b, 0);
  if (tot <= 0) return null;
  let r = rnd(S) * tot;
  for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}
