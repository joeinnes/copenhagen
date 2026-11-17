import type { Plan, Rec, Sched, Team } from './types';
import { CH, DEFER } from './defaults';
import { type Ctx } from './ctx';
import { attend, coverOK, dayVol, getTeams, isOpenIv, isWE, minPpl, minSeat, teamReq, weekdayOpen, weekendOpen } from './demand';
import { allowedStarts, coverage, optimise, ptCount, ptLen } from './shifts';
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

/** Optimised shift plans for every day and team. Memoised per team, day and headcount within a context. */
export function computePlans(ctx: Ctx, hc: Rec): Plan {
  const plan: Plan = {}, al = allowedStarts();
  for (let d = 0; d < 7; d++) {
    plan[d] = {};
    for (const t of getTeams(ctx)) {
      const H = rosterSize(ctx, hc, t.id, d), k = `${t.id}|${d}|${H}`;
      if (!ctx.planMemo.has(k)) ctx.planMemo.set(k, optimise(ctx, teamReq(ctx, t, d), H, null, al));
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
  const S = ctx.S, E = S.ch, req = teamReq(ctx, team, bd), al = allowedStarts();
  const ok = (H: number) => {
    if (H < minPpl(ctx)) return false;
    const cov = coverage(ctx, optimise(ctx, req, H, null, al)).on;
    if (!coverOK(ctx, team, bd, cov)) return false;
    const r = evalTeamDay(ctx, team, bd, 1, cov, null, null, attend(ctx));
    const s = summarise(ctx, { teams: { x: r } }).ch;
    if (s.voice.off > 0 && (s.voice.sla / s.voice.off < E.voice.slPct / 100 || s.voice.ab / s.voice.off > S.abTarget / 100)) return false;
    if (s.chat.off > 0 && s.chat.sla / s.chat.off < E.chat.slPct / 100) return false;
    for (const c of DEFER) if (s[c].off > 0 && s[c].sla / s[c].off < E[c].slPct / 100) return false;
    return true;
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
  const req = Array.from({ length: 48 }, (_, i) => (isOpenIv(ctx, i) ? f : 0)), al = allowedStarts();
  for (let H = Math.max(1, p); H < 200; H++) if (coverOK(ctx, team, d, coverage(ctx, optimise(ctx, req, H, null, al)).on)) return H;
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

/** Headcount and FTE for a roster: agent-days a week, part-timers counted by their hours, 5 days in 7. */
export function sizing(ctx: Ctx, hc: Rec) {
  const S = ctx.S, nWD = S.openDays.slice(0, 5).filter(Boolean).length, nWE = S.openDays.slice(5).filter(Boolean).length, at = attend(ctx);
  const ph = S.ptOn ? ptLen(ctx) / 2 : 8, hrs = (H: number) => (H - ptCount(ctx, H)) * 8 + ptCount(ctx, H) * ph;
  const rows = getTeams(ctx).map((t) => {
    const h = hc[t.id] || { wd: 0, we: 0 }, wd = nWD ? h.wd : 0, we = nWE ? h.we : 0, days = wd * nWD + we * nWE;
    const ptw = nWD ? ptCount(ctx, wd) : 0, pte = nWE ? ptCount(ctx, we) : 0, fte = (hrs(wd) * nWD + hrs(we) * nWE) / 8 / 5;
    return { t, wd, we, ptw, pte, days, fte, inWd: wd * at, inWe: we * at, contract: Math.ceil(fte - 1e-9) };
  });
  const tot = { wd: 0, we: 0, ptw: 0, pte: 0, days: 0, fte: 0, contract: 0, inWd: 0, inWe: 0 };
  rows.forEach((r) => { for (const k in tot) (tot as any)[k] += (r as any)[k]; });
  return { rows, tot, nWD, nWE };
}
