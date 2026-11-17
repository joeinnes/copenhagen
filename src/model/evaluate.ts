import type { Channel, DeferredChannel, ErlangResult, Sched, Team } from './types';
import { CH, DEFER } from './defaults';
import { type Ctx } from './ctx';
import { getTeams, ghostK, isOpenIv, teamCounts, teamReqEff } from './demand';
import { erlangF, minAgents } from './erlang';

export interface BacklogRun { sl: number; within: number; total: number; backlog: Float64Array; served: Float64Array }

/**
 * First-in, first-out backlog over three identical days (the middle one is measured, so carry-over is realistic).
 * The response clock only runs while the desk is open (a business-hours SLA unless the desk is 24 hours).
 */
export function backlogRun(ctx: Ctx, arr: ArrayLike<number>, cap: ArrayLike<number>, targetH: number): BacklogRun {
  const q: { t: number; n: number }[] = [];
  let within = 0, total = 0;
  const backlog = new Float64Array(48), served = new Float64Array(48);
  const oc = new Float64Array(145);
  for (let g = 0; g < 144; g++) oc[g + 1] = oc[g] + (isOpenIv(ctx, g % 48) ? 1 : 0);
  for (let d = 0; d < 3; d++) for (let i = 0; i < 48; i++) {
    const g = d * 48 + i;
    if (arr[i] > 0) q.push({ t: g, n: arr[i] });
    if (d === 1) total += arr[i];
    let c = cap[i];
    while (c > 1e-9 && q.length) {
      const h = q[0], take = Math.min(c, h.n);
      if (h.t >= 48 && h.t < 96 && (oc[g] - oc[h.t]) * 0.5 + 0.25 <= targetH) within += take;
      if (d === 1) served[i] += take;
      h.n -= take; c -= take;
      if (h.n <= 1e-9) q.shift();
    }
    if (d === 1) backlog[i] = q.reduce((a, x) => a + x.n, 0);
  }
  return { sl: total > 0 ? within / total : 1, within, total, backlog, served };
}

export interface IntervalEval {
  n: number; onSeat: number;
  v: ErlangResult | null; vc: ErlangResult | null; c: ErlangResult | null;
  busyV: number; busyC: number; busyE: number; busyT: number; req: number;
}
export interface TeamDay { team: Team; cnt: Record<Channel, Float64Array>; iv: IntervalEval[]; def: Partial<Record<DeferredChannel, BacklogRun>>; email: BacklogRun | null }

/**
 * One team's day: calls get the agents they need first, then chats; emails and tickets share what's left,
 * in proportion to their workload.
 */
export function evalTeamDay(ctx: Ctx, team: Team, d: number, mult: number, onSeat: ArrayLike<number>, extra?: ArrayLike<number> | null, boost?: Float64Array | null, att = 1): TeamDay {
  const S = ctx.S, sh = 1 - S.shrink / 100, V = S.ch.voice, C = S.ch.chat, o = ctx.erl;
  const cnt = teamCounts(ctx, team, d, mult, boost), req = teamReqEff(ctx, team, d, mult);
  const iv: IntervalEval[] = [], single = team.chs.length === 1;
  const dch = DEFER.filter((c) => team.chs.includes(c) && S.ch[c].on), caps = {} as Record<DeferredChannel, Float64Array>;
  const work = {} as Record<DeferredChannel, number>;
  let wTot = 0;
  for (const c of dch) { work[c] = (cnt[c].reduce((a, x) => a + x, 0) * S.ch[c].aht) / (S.ch[c].conc || 1); wTot += work[c]; caps[c] = new Float64Array(48); }
  for (let i = 0; i < 48; i++) {
    const n = onSeat[i] * sh * att + (extra ? extra[i] : 0), lv = cnt.voice[i] / 1800, lc = cnt.chat[i] / 1800;
    let nv = n, nc = n;
    if (!single) {
      const rv = lv > 0 ? minAgents(lv, V.aht, V.pat!, V.slSec!, V.slPct / 100, 1, o, S.abTarget / 100) : 0;
      const rc = lc > 0 ? minAgents(lc, C.aht, C.pat!, C.slSec!, C.slPct / 100, C.conc, o) : 0;
      if (n >= rv + rc) { const sp = n - rv - rc, av = lv * V.aht, ac = (lc * C.aht) / C.conc, w = av + ac > 0 ? av / (av + ac) : 0.5; nv = rv + sp * w; nc = rc + sp * (1 - w); }
      else { nv = Math.min(n, rv); nc = n - nv; }
    }
    const v = lv > 0 ? erlangF(nv, lv, V.aht, V.pat!, V.slSec!, o) : null;
    const vc = lv > 0 ? erlangF(nv, lv, V.aht, S.model === 'C' ? V.pat! : 0, V.slSec!, o, true) : null;
    const c = lc > 0 ? erlangF(nc * C.conc, lc, C.aht, C.pat!, C.slSec!, o) : null;
    const busyV = v ? lv * V.aht * (1 - v.ab) : 0, busyC = c ? ((lc * C.aht) / C.conc) * (1 - c.ab) : 0;
    const free = Math.max(0, n - busyV - busyC);
    for (const c2 of dch) {
      const sh2 = wTot > 0 ? work[c2] / wTot : 1 / dch.length;
      caps[c2][i] = ((single ? n : free * 0.85 * sh2) * 1800 * (S.ch[c2].conc || 1)) / S.ch[c2].aht;
    }
    iv.push({ n, onSeat: onSeat[i], v, vc, c, busyV, busyC, busyE: 0, busyT: 0, req: req[i] });
  }
  const def: Partial<Record<DeferredChannel, BacklogRun>> = {};
  for (const c2 of dch) {
    const run = backlogRun(ctx, cnt[c2], caps[c2], S.ch[c2].slHrs || 4), E2 = S.ch[c2];
    def[c2] = run;
    for (let i = 0; i < 48; i++) iv[i][c2 === 'email' ? 'busyE' : 'busyT'] = (run.served[i] * E2.aht) / (E2.conc || 1) / 1800;
  }
  return { team, cnt, iv, def, email: def.email || null };
}

export interface DayEval { d: number; teams: Record<string, TeamDay> }

/** Every team's day. Spare language agents (beyond their own requirement) help the English team when allowed. */
export function evalDay(ctx: Ctx, d: number, mult: number, sched: Sched, boost?: Float64Array | null, att = 1): DayEval {
  const S = ctx.S, teams = getTeams(ctx), spare: Record<string, Float64Array> = {}, out: DayEval = { d, teams: {} };
  const order = [...teams].sort((a, b) => Number(a.lang === 'l0') - Number(b.lang === 'l0'));
  for (const t of order) {
    const key = S.mode === 'blended' ? 'all' : t.chs[0];
    const extra = t.lang === 'l0' && S.spare ? spare[key] : null;
    const r = evalTeamDay(ctx, t, d, mult, sched[t.id] || new Float64Array(48), extra, boost, att);
    out.teams[t.id] = r;
    if (t.lang !== 'l0' && S.spare) {
      const sp = spare[key] || (spare[key] = new Float64Array(48));
      r.iv.forEach((x, i) => { sp[i] += Math.floor(Math.max(0, x.n - x.req) + 1e-9); });
    }
  }
  return out;
}

export interface ChTotals { off: number; sla: number; ab: number; asa: number; slc: number }
export const blankCh = (): ChTotals => ({ off: 0, sla: 0, ab: 0, asa: 0, slc: 0 });
const f48 = () => new Float64Array(48);

/** Totals for a day, per channel, per language and per half hour, counting this client's contacts only. */
export function summarise(ctx: Ctx, res: { teams: Record<string, TeamDay> }) {
  const s = {
    ch: { voice: blankCh(), chat: blankCh(), email: blankCh(), ticket: blankCh() } as Record<Channel, ChTotals>,
    lang: {} as Record<string, Record<Channel, ChTotals>>,
    iv: {
      voice: { off: f48(), sla: f48(), ab: f48(), lq: f48(), w: f48() },
      chat: { off: f48(), sla: f48(), ab: f48(), lq: f48() },
      email: { off: f48(), backlog: f48() },
      ticket: { off: f48(), backlog: f48() },
    },
    ivLang: {} as Record<string, { off: Float64Array; sla: Float64Array }>,
    busy: 0, avail: 0,
  };
  const K = ghostK(ctx);
  for (const id in res.teams) {
    const r = res.teams[id], L = r.team.lang;
    const sl = s.lang[L] || (s.lang[L] = { voice: blankCh(), chat: blankCh(), email: blankCh(), ticket: blankCh() });
    const il = s.ivLang[L] || (s.ivLang[L] = { off: f48(), sla: f48() });
    r.iv.forEach((x, i) => {
      s.busy += x.busyV + x.busyC + x.busyE + (x.busyT || 0); s.avail += x.n;
      if (x.v) {
        const o = r.cnt.voice[i] / K;
        for (const t of [s.ch.voice, sl.voice]) { t.off += o; t.sla += o * x.v.sl; t.ab += o * x.v.ab; t.asa += o * x.v.asa; t.slc += o * x.vc!.sl; }
        s.iv.voice.off[i] += o; s.iv.voice.sla[i] += o * x.v.sl; s.iv.voice.ab[i] += o * x.v.ab; s.iv.voice.lq[i] += x.v.lq;
        s.iv.voice.w[i] += o * (x.v.pw > 0 ? x.v.asa / x.v.pw : 0);
        il.off[i] += o; il.sla[i] += o * x.v.sl;
      }
      if (x.c) {
        const o = r.cnt.chat[i] / K;
        for (const t of [s.ch.chat, sl.chat]) { t.off += o; t.sla += o * x.c.sl; t.ab += o * x.c.ab; t.asa += o * x.c.asa; }
        s.iv.chat.off[i] += o; s.iv.chat.sla[i] += o * x.c.sl; s.iv.chat.ab[i] += o * x.c.ab; s.iv.chat.lq[i] += x.c.lq;
      }
    });
    for (const c of DEFER) {
      const run = r.def && r.def[c];
      if (!run) continue;
      for (const t of [s.ch[c], sl[c]]) { t.off += run.total / K; t.sla += run.within / K; }
      run.backlog.forEach((b, i) => { s.iv[c].backlog[i] += b / K; });
      r.cnt[c].forEach((v, i) => { s.iv[c].off[i] += v / K; });
    }
  }
  return s;
}
export type DaySummary = ReturnType<typeof summarise>;
export { CH };
