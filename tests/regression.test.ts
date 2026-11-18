// The model must reproduce the numbers recorded from the original single-file build (tests/fixtures/baseline.json).
import { describe, expect, it } from 'vitest';
import baseline from './fixtures/baseline.json';
import { CH, type Config, computePlans, computeRec, confTarget, defaults, makeCtx, periodP, runMC, searchConfidence, sizing } from '../src/model';

function scenario(cfg: Record<string, unknown>): Config {
  const S = defaults();
  for (const [path, v] of Object.entries(cfg)) {
    const ks = path.split('.'), last = ks.pop()!;
    (ks.reduce((o: any, k) => o[k], S) as any)[last] = v;
  }
  S.confOn = false;
  // the baseline predates start-time preferences: compare against rotas placed purely on cover
  S.shiftPrefs = false;
  return S;
}
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const scenarios = Object.entries(baseline).filter(([k]) => k !== 'confidence') as [string, any][];

describe.each(scenarios)('%s', (_name, b) => {
  const ctx = makeCtx(scenario(b.cfg));
  const { rec, minh } = computeRec(ctx);
  const plan = computePlans(ctx, rec);

  it('recommends the same roster', () => {
    expect(rec).toEqual(b.rec0);
    expect(minh).toEqual(b.minh);
  });
  it('gives the same FTE', () => {
    expect(sizing(ctx, rec).tot.contract).toBe(b.fte);
    expect(r6(sizing(ctx, rec).tot.fte)).toBe(b.rotaFte);
  });
  it('builds the same Monday shift plan', () => {
    expect(plan[0]).toEqual(b.plan0);
  });
  it('simulates the same week and month odds', () => {
    const w = runMC(ctx, { period: 'week', hc: rec, plan, seed: 4242 });
    const m = runMC(ctx, { period: 'month', hc: rec, plan, seed: 4242 });
    const rP = (P: Record<string, number | null>) => Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v == null ? null : r6(v)]));
    expect(rP(w.P)).toEqual(b.weekP);
    expect(rP(m.P)).toEqual(b.monthP);
    for (const c of CH) {
      expect(r6(w.exp.ch[c].off)).toBeCloseTo(b.weekExp[c].off, 4);
      expect(r6(w.exp.ch[c].sla)).toBeCloseTo(b.weekExp[c].sla, 4);
      expect(r6(w.exp.ch[c].ab)).toBeCloseTo(b.weekExp[c].ab, 4);
    }
  });
  it('gives the same confidence-search odds for the forecast roster', () => {
    expect(r6(periodP(ctx, rec))).toBe(b.weekPFor);
  });
});

describe('confidence search (default: at most 1 missed month in 84)', () => {
  const S = defaults();
  S.shiftPrefs = false;
  const ctx = makeCtx(S);
  const { rec, minh } = computeRec(ctx);
  it('aims for 98.8% of months', () => {
    expect(confTarget(S)).toBeCloseTo(baseline.confidence.target, 10);
  });
  it('finds the same roster and odds', () => {
    const r = searchConfidence(ctx, rec, minh, 60_000);
    expect(r.hc).toEqual(baseline.confidence.hc);
    expect(r.p).toBe(baseline.confidence.p);
    expect(sizing(ctx, r.hc).tot.contract).toBe(baseline.confidence.fte);
  }, 120_000);
});
