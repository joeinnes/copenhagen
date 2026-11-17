import type { ErlangResult } from './types';
import { clamp } from './util';

/** How abandoned contacts count in the service level, and which queue model is in force. */
export interface ErlangOpts {
  model: 'A' | 'C';
  slBasis: 'offered' | 'short' | 'answered';
  shortAb: number;
}

/**
 * M/M/n+M (Erlang A). Rates per second. Erlang C is Erlang A with infinite patience, so pat = 0 gives Erlang C.
 * Returns the service level (answered within T, on the contract's basis), abandon probability, P(wait),
 * mean queue length, mean wait across all arrivals and occupancy.
 */
export function erlangCore(n: number, lam: number, aht: number, pat: number, T: number, opts: Pick<ErlangOpts, 'slBasis' | 'shortAb'>): ErlangResult {
  if (lam <= 0) return { sl: 1, ab: 0, pw: 0, lq: 0, asa: 0, occ: 0 };
  const mu = 1 / aht, th = pat > 0 ? 1 / pat : 0;
  if (n <= 0) return th > 0 ? { sl: 0, ab: 1, pw: 1, lq: lam * pat, asa: pat, occ: 0 } : { sl: 0, ab: 0, pw: 1, lq: lam * 900, asa: 900, occ: 1, unstable: true };
  const a = lam / mu;
  // Erlang C with more traffic than servers: the queue grows through the interval; keep the numbers finite
  if (th === 0 && lam >= n * mu) return { sl: 0, ab: 0, pw: 1, lq: Math.max(1, (lam - n * mu) * 900), asa: 900, occ: 1, unstable: true };
  let term = 1, below = 0;
  for (let k = 0; k < n; k++) { below += term; term *= a / (k + 1); if (term > 1e200) { term /= 1e200; below /= 1e200; } }
  let sumQ = 0, eq = 0;
  if (th === 0) { const r = lam / (n * mu); sumQ = term / (1 - r); eq = (term * r) / ((1 - r) * (1 - r)); }
  else {
    let q = term;
    for (let j = 0; j < 30000; j++) {
      sumQ += q; eq += j * q; q *= lam / (n * mu + (j + 1) * th);
      if (q > 1e200) { q /= 1e200; sumQ /= 1e200; eq /= 1e200; below /= 1e200; }
      if (q < sumQ * 1e-12 && j > 3) break;
    }
  }
  const tot = below + sumQ, pw = sumQ / tot, lq = eq / tot, ab = th > 0 ? Math.min(1, (th * lq) / lam) : 0;
  const ew = lq / lam, w = pw > 0 ? ew / pw : 0;
  let sl: number;
  if (pw <= 1e-12 || w <= 0) sl = 1 - pw;
  else { const e = Math.exp(-T / w); sl = 1 - pw * (e + th * w * (1 - e)); }
  // contractual basis: abandoned contacts can be excluded from the denominator
  if (th > 0 && opts.slBasis === 'answered' && ab < 1) sl = sl / (1 - ab);
  else if (th > 0 && opts.slBasis === 'short' && w > 0) { const abS = pw * th * w * (1 - Math.exp(-opts.shortAb / w)); sl = sl / (1 - Math.min(0.99, abS)); }
  return { sl: clamp(sl, 0, 1), ab, pw, lq, asa: ew, occ: Math.min(1, (a * (1 - ab)) / n) };
}

/** The queue model in force: Erlang C ignores patience. */
export function erlang(n: number, lam: number, aht: number, pat: number, T: number, o: ErlangOpts): ErlangResult {
  return erlangCore(n, lam, aht, o.model === 'C' ? 0 : pat, T, o);
}

/** Fractional agents: interpolate between the whole numbers either side. `raw` bypasses the model choice (used for the comparison figure). */
export function erlangF(nf: number, lam: number, aht: number, pat: number, T: number, o: ErlangOpts, raw = false): ErlangResult {
  const F = raw ? (n: number) => erlangCore(n, lam, aht, pat, T, o) : (n: number) => erlang(n, lam, aht, pat, T, o);
  nf = Math.max(0, nf);
  const lo = Math.floor(nf), f = nf - lo;
  const A = F(lo); if (f < 1e-6) return A;
  const B = F(lo + 1);
  const out = {} as ErlangResult;
  for (const k of ['sl', 'ab', 'pw', 'lq', 'asa', 'occ'] as const) out[k] = (1 - f) * A[k] + f * B[k];
  if (!isFinite(out.lq)) { out.lq = A.lq; out.asa = A.asa; }
  out.unstable = !!(A.unstable && B.unstable);
  return out;
}

const reqMemo = new Map<string, number>();
/** Fewest agents (divided by concurrency) that meet the service level target and, optionally, an abandon cap. */
export function minAgents(lam: number, aht: number, pat: number, T: number, target: number, conc: number, o: ErlangOpts, abMax = 1): number {
  if (lam <= 0) return 0;
  const key = `${lam.toPrecision(4)}|${aht}|${pat}|${T}|${target}|${conc}|${abMax}|${o.slBasis}|${o.shortAb}|${o.model}`;
  const hit = reqMemo.get(key);
  if (hit !== undefined) return hit;
  const ok = (n: number) => { const r = erlang(n, lam, aht, pat, T, o); return r.sl >= target && r.ab <= abMax; };
  let n = Math.max(1, Math.floor(lam * aht * 0.7));
  while (n < 20000 && !ok(n)) n++;
  while (n > 1 && ok(n - 1)) n--;
  const r = n / conc;
  if (reqMemo.size > 200000) reqMemo.clear();
  reqMemo.set(key, r);
  return r;
}
