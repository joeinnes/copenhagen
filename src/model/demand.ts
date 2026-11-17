import type { Channel, DeferredChannel, Team } from './types';
import { CH, CHN, DEFER } from './defaults';
import { type Ctx, cached } from './ctx';
import { minAgents } from './erlang';
import { clamp } from './util';

export const openDayCount = (ctx: Ctx) => ctx.S.openDays.filter(Boolean).length;
export const isWE = (d: number) => d >= 5;
export const weekendOpen = (ctx: Ctx) => ctx.S.openDays[5] || ctx.S.openDays[6];
export const weekdayOpen = (ctx: Ctx) => ctx.S.openDays.slice(0, 5).some(Boolean);

/** Contacts per week for a channel, whatever period the volume was entered in. */
export function weeklyVol(ctx: Ctx, c: Channel): number {
  const S = ctx.S, v = S.ch[c].vol;
  return S.period === 'day' ? v * openDayCount(ctx) : S.period === 'week' ? v : (v * 7) / 30.44;
}

/** Contacts on a given day of the week (0 = Monday), spread by the day-of-week weights over open days. */
export function dayVol(ctx: Ctx, c: Channel, d: number): number {
  const S = ctx.S;
  if (!S.ch[c].on || !S.openDays[d]) return 0;
  let sw = 0;
  S.dayW.forEach((w, i) => { if (S.openDays[i]) sw += w; });
  return sw > 0 ? (weeklyVol(ctx, c) * S.dayW[d]) / sw : 0;
}

/** Is half-hour interval i (0-47) inside opening hours? Opening hours may run past midnight. */
export function isOpenIv(ctx: Ctx, i: number): boolean {
  const S = ctx.S;
  if (S.h24) return true;
  const o = S.openFrom * 2, c = S.openTo * 2;
  return o < c ? i >= o && i < c : i >= o || i < c;
}

/** Share of a day's contacts arriving in each half hour (sums to 1 over open intervals). */
export function profile(ctx: Ctx, c: Channel): Float64Array {
  return cached(ctx, 'prof' + c, () => {
    const cu = ctx.S.ch[c].curve, p = new Float64Array(48);
    let s = 0;
    for (let i = 0; i < 48; i++) {
      const h = i >> 1, prev = cu[(h + 23) % 24], next = cu[(h + 1) % 24];
      const v = i % 2 === 0 ? 0.25 * prev + 0.75 * cu[h] : 0.75 * cu[h] + 0.25 * next;
      p[i] = isOpenIv(ctx, i) ? Math.max(0, v) : 0; s += p[i];
    }
    for (let i = 0; i < 48; i++) p[i] = s > 0 ? p[i] / s : 0;
    return p;
  });
}

export function activeLangs(ctx: Ctx) {
  return ctx.S.langs.map((l, i) => ({ ...l, key: 'l' + i, i })).filter((l) => l.i === 0 || l.on);
}

/** Share of contacts in a language; the first language (English) takes whatever the others leave. */
export function langFrac(ctx: Ctx, key: string): number {
  const ls = activeLangs(ctx);
  const others = ls.filter((l) => l.key !== 'l0').reduce((a, l) => a + (+l.share || 0), 0);
  if (key === 'l0') return Math.max(0, 100 - others) / 100;
  const l = ls.find((x) => x.key === key);
  return l ? (+l.share || 0) / 100 : 0;
}

export function getTeams(ctx: Ctx): Team[] {
  return cached(ctx, 'teams', () => {
    const S = ctx.S, chs = CH.filter((c) => S.ch[c].on), t: Team[] = [];
    for (const L of activeLangs(ctx)) {
      if (S.mode === 'blended') {
        if (chs.length) t.push({ id: L.key + '|all', lang: L.key, langName: L.name, chs, label: L.name, sub: 'Blended: ' + chs.map((c) => CHN[c].toLowerCase()).join(', ') });
      } else for (const c of chs) t.push({ id: L.key + '|' + c, lang: L.key, langName: L.name, chs: [c], label: L.name + ' ' + CHN[c].toLowerCase(), sub: 'Dedicated' });
    }
    return t;
  });
}

/** Shared service: other clients' contacts ("ghost contacts") join the queues at (clients - 1) x this client's rate. */
export const ghostK = (ctx: Ctx) => (ctx.S.shared ? Math.max(1, Math.round(+ctx.S.clients || 1)) : 1);
/** Every channel gets ghost contacts at the same rate, so this client's share of the pool is 1 / clients. */
export const clientShare = (ctx: Ctx) => 1 / ghostK(ctx);

/** Contacts per half hour for a team on a day, including ghost contacts and an optional call-volume boost (incidents). */
export function teamCounts(ctx: Ctx, team: Team, d: number, mult: number, boost?: Float64Array | null): Record<Channel, Float64Array> {
  const lf = langFrac(ctx, team.lang), o = {} as Record<Channel, Float64Array>;
  for (const c of CH) {
    const a = new Float64Array(48);
    if (team.chs.includes(c)) {
      const dv = dayVol(ctx, c, d) * mult * lf * ghostK(ctx), p = profile(ctx, c);
      for (let i = 0; i < 48; i++) a[i] = dv * p[i] * (boost && c === 'voice' ? boost[i] : 1);
    }
    o[c] = a;
  }
  return o;
}

/** Deferred work spread over its response window: agents needed per half hour to keep the backlog moving. */
export function deferredSmooth(ctx: Ctx, cnt: Float64Array, c: DeferredChannel): Float64Array {
  const E = ctx.S.ch[c], W = Math.max(1, Math.round((E.slHrs || 4) * 2)), out = new Float64Array(48);
  const load = Array.from(cnt, (x) => (x * E.aht) / E.conc / 1800);
  for (let i = 0; i < 48; i++) {
    let s = 0, n = 0;
    for (let k = 0; k < W; k++) { let j = i - k; if (j < 0) j += 48; s += load[j]; n++; }
    out[i] = n ? s / n : 0;
  }
  return out;
}

/** Agents needed on seat (before shrinkage and absence) per half hour for a team on a day. */
export function teamReqEff(ctx: Ctx, team: Team, d: number, mult = 1): Float64Array {
  return cached(ctx, `req|${team.id}|${d}|${mult}`, () => {
    const S = ctx.S, V = S.ch.voice, C = S.ch.chat, cnt = teamCounts(ctx, team, d, mult), es = new Float64Array(48), r = new Float64Array(48);
    for (const c of DEFER) { const sm = deferredSmooth(ctx, cnt[c], c); for (let i = 0; i < 48; i++) es[i] += sm[i]; }
    for (let i = 0; i < 48; i++) {
      const lv = cnt.voice[i] / 1800, lc = cnt.chat[i] / 1800;
      const rv = lv > 0 ? minAgents(lv, V.aht, V.pat!, V.slSec!, V.slPct / 100, 1, ctx.erl, S.abTarget / 100) : 0;
      const rc = lc > 0 ? minAgents(lc, C.aht, C.pat!, C.slSec!, C.slPct / 100, C.conc, ctx.erl) : 0;
      // blended teams pool: chat can soak up some of the idle slack voice needs to keep for its target
      let n = team.chs.length > 1 ? rv + Math.max((lc * C.aht) / C.conc, rc - 0.5 * Math.max(0, rv - lv * V.aht)) : rv + rc;
      n += es[i]; r[i] = n;
    }
    return r;
  });
}

/** Absence: each rostered agent is independently away on a given day with p = (leave + sick days) / 260 working days. */
export const WORKDAYS = 260;
export const pLeave = (ctx: Ctx) => clamp((+ctx.S.alDays || 0) / WORKDAYS, 0, 0.6);
export const pSick = (ctx: Ctx) => clamp((+ctx.S.sickDays || 0) / WORKDAYS, 0, 0.4);
export const attend = (ctx: Ctx) => Math.max(0.2, 1 - pLeave(ctx) - pSick(ctx));

/**
 * Minimum staffing (not for shared desks): enough agents on seat in every open half hour that cover survives one
 * person on leave or off sick while lunches are still taken, and never fewer than minPeople in a team.
 */
export const minRule = (ctx: Ctx) => ctx.S.minOn && !ctx.S.shared;
export const minSeat = (ctx: Ctx) => (minRule(ctx) ? Math.max(0, Math.round(+ctx.S.minOnSeat || 0)) : 0);
export const minPpl = (ctx: Ctx) => (minRule(ctx) ? Math.max(0, Math.round(+ctx.S.minPeople || 0)) : 0);
const teamOpen = (ctx: Ctx, team: Team, d: number) => CH.some((c) => team.chs.includes(c) && dayVol(ctx, c, d) > 0);

/** Agents to roster on seat per half hour: the requirement after shrinkage and absence, floored by minimum cover. */
export function teamReq(ctx: Ctx, team: Team, d: number): Float64Array {
  const sh = 1 - ctx.S.shrink / 100, f = minSeat(ctx), open = teamOpen(ctx, team, d), at = attend(ctx);
  return teamReqEff(ctx, team, d).map((x, i) => { const r = x / sh / at; return open && f && isOpenIv(ctx, i) ? Math.max(r, f) : r; });
}

/** Does a plan's cover meet the minimum-staffing rule in every open half hour? */
export function coverOK(ctx: Ctx, team: Team, d: number, cov: Float64Array): boolean {
  const f = minSeat(ctx);
  if (!f || !teamOpen(ctx, team, d)) return true;
  for (let i = 0; i < 48; i++) if (isOpenIv(ctx, i) && cov[i] < f) return false;
  return true;
}
