import { describe, expect, it } from 'vitest';
import {
  backlogRun, computePlans, computeRec, confTarget, coverage, defaults, erlang, erlangCore, getTeams, isNightStart, makeCtx, meetsTargets,
  minAgents, searchConfidence, sizing, startPenalty,
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

describe('long weekend shifts', () => {
  // A tiny round-the-clock desk: the minimum-staffing rule (2 on seat, cover through leave and lunches) sets the roster.
  const tiny = (weLong: boolean) => {
    const S = defaults();
    for (const c of ['voice', 'chat', 'email', 'ticket'] as const) S.ch[c].vol = 70;
    S.langs[1].on = false; S.weLong = weLong;
    return makeCtx(S);
  };
  it('two 12-hour weekend shifts and two 8-hour weekdays make one FTE', () => {
    const ctx = tiny(true), id = getTeams(ctx)[0].id;
    // 1 agent each weekend day (2 × 12h) plus 1 agent on 2 of the 5 weekdays (2 × 8h): spread as 0.4 a weekday
    expect(sizing(ctx, { [id]: { wd: 0.4, we: 1 } }).tot.fte).toBeCloseTo(1, 9);
  });
  it('weekend plans use only long shifts, weekdays stay 9-hour', () => {
    const ctx = tiny(true), r = computeRec(ctx), plan = computePlans(ctx, r.rec), id = getTeams(ctx)[0].id;
    expect(plan[5][id].every((x) => x >= 200)).toBe(true);
    expect(plan[0][id].every((x) => x < 100)).toBe(true);
  });
  it('cover 24 hours at the weekend with fewer people and fewer FTE', () => {
    const off = tiny(false), on = tiny(true), id = getTeams(on)[0].id;
    const rOff = computeRec(off).rec[id], rOn = computeRec(on).rec[id];
    expect(rOn.we).toBeLessThan(rOff.we);
    expect(rOn.wd).toBe(rOff.wd);
    expect(sizing(on, computeRec(on).rec).tot.fte).toBeLessThan(sizing(off, computeRec(off).rec).tot.fte);
  });
  it('still meets minimum cover through the weekend', () => {
    const ctx = tiny(true), r = computeRec(ctx), plan = computePlans(ctx, r.rec), id = getTeams(ctx)[0].id;
    const cov = coverage(ctx, plan[6][id]).on;
    expect(Math.min(...cov)).toBeGreaterThanOrEqual(2);
  });
});

describe('sociable start times', () => {
  it('scores starts: ideal windows free, nights dearest', () => {
    expect([16, 20, 26, 30, 42, 45].map(startPenalty)).toEqual([0, 0, 0, 0, 0, 0]); // 08:00 10:00 13:00 15:00 21:00 22:30
    expect([46, 0, 6, 11].map(startPenalty)).toEqual([3, 3, 3, 3]); // 23:00 00:00 03:00 05:30
    expect([12, 14, 22, 36].map(startPenalty)).toEqual([1, 1, 1, 1]); // 06:00 07:00 11:00 18:00
  });
  const both = () => {
    const on = makeCtx(defaults()), offS = defaults(); offS.shiftPrefs = false;
    return { on, off: makeCtx(offS) };
  };
  it('never changes the recommended headcount', () => {
    const { on, off } = both();
    expect(computeRec(on).rec).toEqual(computeRec(off).rec);
  });
  it('uses fewer night starts, and every day still meets the targets the plain rota met', () => {
    const { on, off } = both(), rec = computeRec(on).rec, pOn = computePlans(on, rec), pOff = computePlans(off, rec);
    let nOn = 0, nOff = 0;
    for (let d = 0; d < 7; d++) for (const t of getTeams(on)) {
      nOn += pOn[d][t.id].filter(isNightStart).length; nOff += pOff[d][t.id].filter(isNightStart).length;
      if (meetsTargets(off, t, d, coverage(off, pOff[d][t.id]).on)) expect(meetsTargets(on, t, d, coverage(on, pOn[d][t.id]).on)).toBe(true);
    }
    expect(nOn).toBeLessThan(nOff);
  });
  it('the contract-risk search finds the same roster as with plain rotas, and still meets the aim', () => {
    const { on, off } = both(), r0 = computeRec(on);
    const a = searchConfidence(on, r0.rec, r0.minh, 60_000), b = searchConfidence(off, r0.rec, r0.minh, 60_000);
    expect(a.hc).toEqual(b.hc);
    expect(a.p!).toBeGreaterThanOrEqual(confTarget(on.S));
  }, 120_000);
});
