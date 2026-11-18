import type { Plan, Rec, Sched, Team } from './types';
import { CH, DEFER } from './defaults';
import { type Ctx } from './ctx';
import { attend, coverOK, dayVol, getTeams, isOpenIv, isWE, minPpl, minSeat, teamReq, weekdayOpen, weekendOpen } from './demand';
import { allowedStarts, coverage, isNightStart, longLen, longOn, optimise, planPenalty, ptCount, ptLen, shS } from './shifts';
import { evalTeamDay, summarise } from './evaluate';

/** Agents rostered for a team on a day (weekday or weekend headcount), zero if the desk is closed. */
export function rosterSize(ctx: Ctx, hc: Rec, id: string, d: number): number {
  const h = hc[id];
  if (!h || !ctx.S.openDays[d]) return 0;
  return Math.max(0, Math.round(isWE(d) ? h.we : h.wd));
}

/** Desks a team needs: the larger of its weekday and weekend rosters. */
export function deskCount(ctx: Ctx, hc: Rec, id: string): number {
  const h = hc[id];
  if (!h) return 0;
  return Math.max(weekdayOpen(ctx) ? Math.round(h.wd) : 0, weekendOpen(ctx) ? Math.round(h.we) : 0);
}

/** Does this cover hit every target for a team on a day, on the forecast? */
export function meetsTargets(ctx: Ctx, team: Team, d: number, cov: ArrayLike<number>): boolean {
  const S = ctx.S, E = S.ch;
  const r = evalTeamDay(ctx, team, d, 1, cov, null, null, attend(ctx));
  const s = summarise(ctx, { teams: { x: r } }).ch;
  if (s.voice.off > 0 && (s.voice.sla / s.voice.off < E.voice.slPct / 100 || s.voice.ab / s.voice.off > S.abTarget / 100)) return false;
  if (s.chat.off > 0 && s.chat.sla / s.chat.off < E.chat.slPct / 100) return false;
  for (const c of DEFER) if (s[c].off > 0 && s[c].sla / s[c].off < E[c].slPct / 100) return false;
  return true;
}
/** Agent-hours on the day where cover falls short of the requirement. */
const shortfall = (req: ArrayLike<number>, cov: ArrayLike<number>) => { let s = 0; for (let i = 0; i < 48; i++) s += Math.max(0, req[i] - cov[i]); return s / 2; };

/** Preference strengths tried in turn when looking for a more sociable rota (see startPenalty). */
const PREF_STEPS = [8, 4, 2, 1];
/** Where a night start goes instead: later into the morning first (06:00–07:00), then earlier into the evening (21:00–22:30). */
const NIGHT_MOVES = [12, 13, 14, 45, 44, 43, 42];
/**
 * The rota for one team and day at a given headcount. The optimiser first places shifts purely on cover; headcount is
 * always sized on that plain rota, so nothing here adds people. If the scenario prefers sociable start times:
 *  1. re-run the optimiser with start-time penalties, strongest first, and take the first rota that passes the checks;
 *  2. then take each remaining night start (23:00–05:30) and move it to 06:00–07:00, or failing that 21:00–22:30,
 *     keeping each move only if the rota still passes.
 * The checks: minimum cover and every target the plain rota met are still met, and the under-covered agent-hours grow by
 * no more than 5% (at least half an agent-hour), so the rota's odds over many simulated days barely move.
 */
export function planDay(ctx: Ctx, team: Team, d: number, H: number): number[] {
  const req = teamReq(ctx, team, d), al = allowedStarts(ctx), base = optimise(ctx, req, H, null, al, d);
  if (ctx.plainPlans || ctx.S.shiftPrefs === false || !base.length || !planPenalty(base)) return base;
  const cov0 = coverage(ctx, base).on, cover0 = coverOK(ctx, team, d, cov0), meets0 = meetsTargets(ctx, team, d, cov0);
  const maxShort = shortfall(req, cov0) * 1.05 + 0.5;
  const passes = (p: number[]) => {
    const cov = coverage(ctx, p).on;
    return (!cover0 || coverOK(ctx, team, d, cov)) && shortfall(req, cov) <= maxShort && (!meets0 || meetsTargets(ctx, team, d, cov));
  };
  let best = base;
  for (const pref of PREF_STEPS) {
    const p = optimise(ctx, req, H, null, al, d, pref);
    if (planPenalty(p) < planPenalty(best) && passes(p)) { best = p; break; }
  }
  best = best.slice();
  for (let k = 0; k < best.length; k++) {
    if (!isNightStart(best[k])) continue;
    const kind = best[k] - shS(best[k]);
    for (const s of NIGHT_MOVES) {
      if (!al.includes(s)) continue;
      const trial = best.slice(); trial[k] = kind + s;
      if (passes(trial)) { best = trial; break; }
    }
  }
  return best.sort((x, y) => x - y);
}

/** Optimised shift plans for every day and team. Memoised per team, day and headcount within a context. */
export function computePlans(ctx: Ctx, hc: Rec): Plan {
  const plan: Plan = {};
  for (let d = 0; d < 7; d++) {
    plan[d] = {};
    for (const t of getTeams(ctx)) {
      const H = rosterSize(ctx, hc, t.id, d), k = `${t.id}|${d}|${H}`;
      if (!ctx.planMemo.has(k)) ctx.planMemo.set(k, planDay(ctx, t, d, H));
      plan[d][t.id] = ctx.planMemo.get(k)!.slice();
    }
  }
  return plan;
}

export function plannedSched(ctx: Ctx, plan: Plan, d: number): Sched {
  const o: Sched = {};
  for (const t of getTeams(ctx)) o[t.id] = coverage(ctx, plan[d][t.id]).on;
  return o;
}

/** Busiest of the given days for a team, by total contacts (null if all closed or quiet). */
export function busiest(ctx: Ctx, team: Team, days: number[]): number | null {
  let bd: number | null = null, bv = 0;
  for (const d of days) {
    const v = CH.reduce((a, c) => a + (team.chs.includes(c) ? dayVol(ctx, c, d) : 0), 0);
    if (v > bv) { bv = v; bd = d; }
  }
  return bd;
}

/** Smallest roster for a team on a day whose optimised plan hits every target and the minimum-staffing rule. */
export function suggestDay(ctx: Ctx, team: Team, bd: number | null, warn?: Set<string>): number {
  if (bd == null) return 0;
  const req = teamReq(ctx, team, bd), al = allowedStarts(ctx);
  // headcount is sized on the plain, cover-only rota, so start-time preferences can never add people
  const ok = (H: number) => {
    if (H < minPpl(ctx)) return false;
    const cov = coverage(ctx, optimise(ctx, req, H, null, al, bd)).on;
    return coverOK(ctx, team, bd, cov) && meetsTargets(ctx, team, bd, cov);
  };
  const tot = req.reduce((a, x) => a + x, 0);
  let lo = Math.max(1, minPpl(ctx), Math.floor((tot / 16) * 0.6)), hi = Math.max(lo + 2, Math.ceil((tot / 16) * 1.6) + 4);
  let guard = 0;
  while (!ok(hi) && hi < 600 && guard++ < 12) hi = Math.ceil(hi * 1.5);
  if (!ok(hi)) { warn?.add(team.label); return Math.min(hi, 400); }
  while (lo < hi) { const m = (lo + hi) >> 1; if (ok(m)) hi = m; else lo = m + 1; }
  return lo;
}

/** Smallest roster that meets the minimum-staffing rule on its own (cover through leave and lunches). */
export function minCoverH(ctx: Ctx, team: Team, d: number | null): number {
  if (d == null) return 0;
  const f = minSeat(ctx), p = minPpl(ctx);
  if (!f && !p) return 0;
  const req = Array.from({ length: 48 }, (_, i) => (isOpenIv(ctx, i) ? f : 0)), al = allowedStarts(ctx);
  for (let H = Math.max(1, p); H < 200; H++) if (coverOK(ctx, team, d, coverage(ctx, optimise(ctx, req, H, null, al, d)).on)) return H;
  return 200;
}

export interface RecResult { rec: Rec; minh: Rec; warn: string[] }

/** Forecast-based recommendation: each team sized on its busiest weekday and busiest weekend day. */
export function computeRec(ctx: Ctx): RecResult {
  const rec: Rec = {}, minh: Rec = {}, warn = new Set<string>();
  for (const t of getTeams(ctx)) {
    const dW = busiest(ctx, t, [0, 1, 2, 3, 4]), dE = busiest(ctx, t, [5, 6]);
    minh[t.id] = { wd: minCoverH(ctx, t, dW), we: minCoverH(ctx, t, dE) };
    rec[t.id] = {
      wd: Math.max(suggestDay(ctx, t, dW, warn), dW == null ? 0 : minh[t.id].wd),
      we: Math.max(suggestDay(ctx, t, dE, warn), dE == null ? 0 : minh[t.id].we),
    };
  }
  return { rec, minh, warn: [...warn] };
}

/**
 * Headcount and FTE for a roster. FTE is paid hours a week ÷ 40: a full-time shift pays 8 hours, a part-time shift its
 * length, and a long weekend shift its length (two 12-hour weekend shifts plus two weekday shifts make 40).
 */
export function sizing(ctx: Ctx, hc: Rec) {
  const S = ctx.S, nWD = S.openDays.slice(0, 5).filter(Boolean).length, nWE = S.openDays.slice(5).filter(Boolean).length, at = attend(ctx);
  const ph = S.ptOn ? ptLen(ctx) / 2 : 8, weFt = longOn(ctx, 5) ? longLen(ctx) / 2 : 8;
  const hrs = (H: number, ft = 8) => (H - ptCount(ctx, H)) * ft + ptCount(ctx, H) * ph;
  const rows = getTeams(ctx).map((t) => {
    const h = hc[t.id] || { wd: 0, we: 0 }, wd = nWD ? h.wd : 0, we = nWE ? h.we : 0, days = wd * nWD + we * nWE;
    const ptw = nWD ? ptCount(ctx, wd) : 0, pte = nWE ? ptCount(ctx, we) : 0, hours = hrs(wd) * nWD + hrs(we, weFt) * nWE, fte = hours / 40;
    return { t, wd, we, ptw, pte, days, hours, fte, inWd: wd * at, inWe: we * at, contract: Math.ceil(fte - 1e-9) };
  });
  const tot = { wd: 0, we: 0, ptw: 0, pte: 0, days: 0, hours: 0, fte: 0, contract: 0, inWd: 0, inWe: 0 };
  rows.forEach((r) => { for (const k in tot) (tot as any)[k] += (r as any)[k]; });
  return { rows, tot, nWD, nWE };
}
