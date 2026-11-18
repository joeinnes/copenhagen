import { type Ctx } from './ctx';
import { isOpenIv, isWE } from './demand';
import { clamp } from './util';

/** A full-time shift in half hours: 4 hours on, a 1-hour lunch, 4 hours on. */
export const SHIFT = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];

// A shift is stored as a number: its start half-hour (0-47), plus 100 × its kind.
// Kinds: 0 full-time (4 on, 1 lunch, 4 on), 1 part-time (no lunch), 2 long weekend shift (e.g. 12 hours, breaks covered by shrinkage).
export const shS = (x: number) => x % 100;
export const shKind = (x: number) => Math.floor(x / 100);
export const shPT = (x: number) => shKind(x) === 1;
export const shLong = (x: number) => shKind(x) === 2;
export const ptLen = (ctx: Ctx) => clamp(Math.round((+ctx.S.ptHours || 4) * 2), 4, 14);
/** Length of a long weekend shift in half hours (10 or 12 hours). */
export const longLen = (ctx: Ctx) => clamp(Math.round((Number(ctx.S.weLongHours) || 12) * 2), 16, 24);
/** Do full-time agents work long shifts on this day? Only at weekends, when the option is on. */
export const longOn = (ctx: Ctx, d: number) => !!ctx.S.weLong && isWE(d);
const MASKS = (ctx: Ctx) => [SHIFT, Array(ptLen(ctx)).fill(1), Array(longLen(ctx)).fill(1)];
const PAIDS = (ctx: Ctx) => [8, ptLen(ctx) / 2, longLen(ctx) / 2];
export const shMask = (ctx: Ctx, x: number) => MASKS(ctx)[shKind(x)];
export const shMins = (ctx: Ctx, x: number) => [540, ptLen(ctx) * 30, longLen(ctx) * 30][shKind(x)];
export const shPaid = (ctx: Ctx, x: number) => PAIDS(ctx)[shKind(x)];

export function ptCount(ctx: Ctx, H: number): number {
  return ctx.S.ptOn ? Math.round((H * clamp(+ctx.S.ptShare || 0, 0, 100)) / 100) : 0;
}
/** One entry per agent: 0 = full-time, 1 = part-time, 2 = long weekend shift (in place of full-time on that day). */
export function typesFor(ctx: Ctx, H: number, d?: number): number[] {
  const pt = ptCount(ctx, H), ft = d != null && longOn(ctx, d) ? 2 : 0;
  return [...Array(Math.max(0, H - pt)).fill(ft), ...Array(pt).fill(1)];
}

/**
 * How much a start time is disliked, per shift: 0 for the ideal handover windows (08:00–10:00, 13:00–15:00, 21:00–22:30),
 * 3 for night starts (23:00–05:30), 1 for anything else. Used only when the scenario prefers sociable starts.
 */
export function startPenalty(s: number): number {
  s = ((s % 48) + 48) % 48;
  if (s >= 46 || s < 12) return 3;
  if ((s >= 16 && s <= 20) || (s >= 26 && s <= 30) || (s >= 42 && s <= 45)) return 0;
  return 1;
}
export const isNightStart = (x: number) => startPenalty(shS(x)) === 3;
/** Total start-time penalty of a plan (lower is more sociable). */
export const planPenalty = (starts: number[]) => starts.reduce((a, x) => a + startPenalty(shS(x)), 0);

/** Every shift may start on any half hour, running past midnight into the next day. */
export const allowedStarts = () => [...Array(48).keys()];

/** Agents on seat and at lunch per half hour, for a set of shift codes (optionally skipping some agents). */
export function coverage(ctx: Ctx, starts: number[], skip?: Set<number>) {
  const on = new Float64Array(48), lunch = new Float64Array(48);
  starts.forEach((x, k) => {
    if (skip && skip.has(k)) return;
    const m = shMask(ctx, x), s = shS(x);
    for (let j = 0; j < m.length; j++) { const i = (s + j) % 48; if (m[j]) on[i]++; else lunch[i]++; }
  });
  return { on, lunch };
}

/**
 * Place shifts against a requirement (agents per half hour). Greedy: each step places whichever shift type and start
 * buys the most cover per paid hour; then shifts are moved one at a time until nothing improves.
 * A closed half hour costs a flat 1.5 per agent on seat (a missing agent while open costs 6), so shifts only
 * overhang the opening hours when that buys real cover.
 */
export function optimise(ctx: Ctx, req: ArrayLike<number>, types: number[] | number, fixedCov: ArrayLike<number> | null, allowed: number[], d?: number, pref = 0): number[] {
  if (typeof types === 'number') types = typesFor(ctx, types, d);
  const cov = fixedCov ? Float64Array.from(fixedCov) : new Float64Array(48);
  if (!allowed.length || !types.length) return [];
  const shut = [...Array(48)].map((_, i) => !isOpenIv(ctx, i));
  const cost = (r: number, c: number, i: number) => { if (shut[i]) return 1.5 * c; const s = Math.max(0, r - c); return s * s * 4 + s * 2 + (0.25 * c * c) / (r + 0.7); };
  const MK = MASKS(ctx), PAID = PAIDS(ctx);
  const delta = (s: number, t: number, sg: number) => {
    const m = MK[t]; let d = 0;
    for (let j = 0; j < m.length; j++) { if (!m[j]) continue; const i = (s + j) % 48; d += cost(req[i], cov[i] + sg, i) - cost(req[i], cov[i], i); }
    return pref ? d + sg * pref * startPenalty(s) : d;
  };
  const add = (s: number, t: number, sg: number) => { const m = MK[t]; for (let j = 0; j < m.length; j++) if (m[j]) cov[(s + j) % 48] += sg; };
  const rem = [0, 1, 2].map((k) => types.filter((t) => t === k).length), st: number[] = [], ty: number[] = [];
  while (rem[0] + rem[1] + rem[2] > 0) {
    let b = allowed[0], bt = 0, bd = Infinity;
    for (const t of [0, 1, 2]) { if (!rem[t]) continue; for (const s of allowed) { const d = delta(s, t, 1) / PAID[t]; if (d < bd) { bd = d; b = s; bt = t; } } }
    add(b, bt, 1); st.push(b); ty.push(bt); rem[bt]--;
  }
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    for (let a = 0; a < st.length; a++) {
      const t = ty[a]; add(st[a], t, -1);
      let b = st[a], bd = delta(b, t, 1);
      for (const s of allowed) { const d = delta(s, t, 1); if (d < bd - 1e-9) { bd = d; b = s; } }
      if (b !== st[a]) moved = true;
      st[a] = b; add(b, t, 1);
    }
    if (!moved) break;
  }
  return st.map((x, a) => x + 100 * ty[a]).sort((x, y) => x - y);
}
