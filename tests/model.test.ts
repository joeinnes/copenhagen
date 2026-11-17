import { describe, expect, it } from 'vitest';
import {
  backlogRun, computePlans, computeRec, confTarget, coverage, defaults, erlang, erlangCore, getTeams, makeCtx, minAgents, sizing,
} from '../src/model';

const offered = { slBasis: 'offered' as const, shortAb: 5 };

describe('Erlang C', () => {
  // Textbook case: 8 Erlangs of traffic on 10 agents. P(wait) = 0.4092; service level in 20s with a 180s handle time
  // = 1 - 0.4092 * exp(-(10 - 8) * 20 / 180) = 0.6724.
  const r = erlangCore(10, 8 / 180, 180, 0, 20, offered);
  it('matches the textbook probability of waiting', () => expect(r.pw).toBeCloseTo(0.4092, 3));
  it('matches the textbook service level', () => expect(r.sl).toBeCloseTo(0.6724, 3));
  it('has no abandons', () => expect(r.ab).toBe(0));
});

describe('Erlang A', () => {
  const C = { model: 'C' as const, ...offered }, A = { model: 'A' as const, ...offered };
  it('is Erlang C when the queue model is C, whatever the patience', () => {
    expect(erlang(10, 8 / 180, 180, 120, 20, C).sl).toBeCloseTo(erlangCore(10, 8 / 180, 180, 0, 20, offered).sl, 12);
  });
  it('gives a better answered-in-time rate than C for the same staff, because callers who give up shorten the queue', () => {
    expect(erlang(10, 8 / 180, 180, 120, 20, A).sl).toBeGreaterThan(erlang(10, 8 / 180, 180, 120, 20, C).sl);
  });
  it('excluding abandons from the denominator flatters the service level', () => {
    const base = erlangCore(9, 8 / 180, 180, 60, 20, offered).sl;
    const answered = erlangCore(9, 8 / 180, 180, 60, 20, { slBasis: 'answered', shortAb: 5 }).sl;
    expect(answered).toBeGreaterThan(base);
  });
  it('minAgents meets the target with one agent fewer failing it', () => {
    const lam = 120 / 3600, o = { model: 'A' as const, ...offered };
    const n = minAgents(lam, 330, 240, 30, 0.8, 1, o);
    expect(erlang(n, lam, 330, 240, 30, o).sl).toBeGreaterThanOrEqual(0.8);
    expect(erlang(n - 1, lam, 330, 240, 30, o).sl).toBeLessThan(0.8);
  });
});

describe('contract aims', () => {
  it('at most 1 missed month in 84 means 98.8% of months', () => {
    const S = defaults();
    expect(confTarget(S)).toBeCloseTo(1 - 1 / 84, 10);
  });
  it('a 50% chance of a clean 84-month contract means 99.18% of months', () => {
    const S = defaults(); S.confMode = 'clean'; S.cleanChance = 50;
    expect(confTarget(S)).toBeCloseTo(Math.pow(0.5, 1 / 84), 10);
  });
});

describe('deferred backlog', () => {
  it('meets the response target when capacity is ample', () => {
    const ctx = makeCtx(defaults());
    const arr = new Float64Array(48).fill(2), cap = new Float64Array(48).fill(10);
    expect(backlogRun(ctx, arr, cap, 4).sl).toBe(1);
  });
  it('misses when there is no capacity', () => {
    const ctx = makeCtx(defaults());
    expect(backlogRun(ctx, new Float64Array(48).fill(2), new Float64Array(48), 4).sl).toBe(0);
  });
});

describe('minimum staffing', () => {
  const tiny = () => {
    const S = defaults(); S.confOn = false;
    S.ch.voice.vol = 70; S.ch.chat.vol = 14; S.ch.email.vol = 14; S.ch.ticket.vol = 14;
    return S;
  };
  it('a 9-hour weekday desk needs at least 3 people per team, even with almost no volume', () => {
    const S = tiny(); S.h24 = false; S.openFrom = 8; S.openTo = 17; S.openDays = [true, true, true, true, true, false, false];
    const ctx = makeCtx(S), { rec } = computeRec(ctx);
    for (const t of getTeams(ctx)) expect(rec[t.id].wd).toBeGreaterThanOrEqual(3);
  });
  it('keeps 2 on seat in every open half hour of every plan', () => {
    const S = tiny(), ctx = makeCtx(S), { rec } = computeRec(ctx), plan = computePlans(ctx, rec);
    for (let d = 0; d < 7; d++) for (const t of getTeams(ctx)) {
      const on = coverage(ctx, plan[d][t.id]).on;
      expect(Math.min(...on)).toBeGreaterThanOrEqual(2);
    }
  });
  it('does not apply to shared desks', () => {
    const S = tiny(); S.shared = true;
    const ctx = makeCtx(S), { minh } = computeRec(ctx);
    for (const t of getTeams(ctx)) expect(minh[t.id]).toEqual({ wd: 0, we: 0 });
  });
});

describe('sizing', () => {
  it('FTE is agent-days over 5', () => {
    const ctx = makeCtx(defaults());
    const hc = { 'l0|all': { wd: 10, we: 5 }, 'l1|all': { wd: 4, we: 2 } };
    const s = sizing(ctx, hc);
    expect(s.tot.days).toBe(10 * 5 + 5 * 2 + 4 * 5 + 2 * 2);
    expect(s.tot.fte).toBeCloseTo(s.tot.days / 5, 10);
  });
});
