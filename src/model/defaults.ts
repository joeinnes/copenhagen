import type { Channel, Config, DeferredChannel } from './types';

export const CH: Channel[] = ['voice', 'chat', 'email', 'ticket'];
export const CHN: Record<Channel, string> = { voice: 'Calls', chat: 'Chats', email: 'Emails', ticket: 'Tickets' };
/** Deferred channels: worked from a backlog in agents' spare time, with a "resolved within X hours" target. */
export const DEFER: DeferredChannel[] = ['email', 'ticket'];
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const PRESET: Record<string, number[]> = {
  office: [1.0, 0.6, 0.4, 0.35, 0.4, 0.8, 2.0, 4.6, 7.6, 8.8, 8.6, 8.0, 7.2, 7.4, 7.6, 7.0, 6.3, 5.5, 4.4, 3.6, 3.0, 2.4, 1.8, 1.3],
  evening: [1.4, 0.9, 0.5, 0.4, 0.4, 0.6, 1.2, 2.6, 4.6, 6.0, 6.5, 6.6, 6.8, 6.9, 6.8, 6.6, 6.4, 6.5, 6.9, 7.1, 6.6, 5.2, 3.6, 2.2],
  email: [0.9, 0.6, 0.5, 0.4, 0.5, 1.0, 2.2, 4.4, 7.6, 8.6, 8.0, 7.4, 6.4, 6.8, 6.8, 6.2, 5.4, 4.4, 3.4, 2.9, 2.5, 2.0, 1.6, 1.1],
  ticket: [1.2, 0.8, 0.6, 0.5, 0.5, 0.9, 1.8, 3.6, 6.4, 7.6, 7.4, 7.0, 6.4, 6.8, 6.9, 6.6, 6.0, 5.2, 4.4, 4.0, 3.6, 3.0, 2.3, 1.6],
  flat: Array(24).fill(4),
};

export const DEFAULT: Config = {
  period: 'week', openDays: [true, true, true, true, true, true, true], h24: true, openFrom: 8, openTo: 20,
  dayW: [1.18, 1.08, 1.02, 1.0, 0.97, 0.68, 0.55], fcErr: 8,
  ch: {
    voice: { on: true, vol: 8400, aht: 330, slPct: 80, slSec: 30, pat: 240, conc: 1, curve: PRESET.office.slice() },
    chat: { on: true, vol: 2450, aht: 600, slPct: 80, slSec: 60, pat: 240, conc: 3, curve: PRESET.evening.slice() },
    email: { on: true, vol: 1750, aht: 420, slPct: 90, slHrs: 4, conc: 1, curve: PRESET.email.slice() },
    ticket: { on: true, vol: 1050, aht: 480, slPct: 90, slHrs: 8, conc: 1, curve: PRESET.ticket.slice() },
  },
  langs: [{ name: 'English', share: 0, on: true }, { name: 'French', share: 14, on: true }, { name: 'German', share: 8, on: false }],
  mode: 'blended', hc: {}, shrink: 20, spare: true, abTarget: 8, slBasis: 'offered', shortAb: 5, model: 'A', name: 'Untitled scenario',
  autoSize: true, alDays: 24, sickDays: 5, minOn: true, minOnSeat: 2, minPeople: 3, ptOn: false, ptHours: 4, ptShare: 30, weLong: false, weLongHours: 12, shiftPrefs: true, noStart: [],
  shared: false, clients: 3, confOn: true, conf: 99, confPeriod: 'month', confMode: 'misses', contractMonths: 84, missesAllowed: 1, cleanChance: 90,
};

/** A fresh copy of the defaults (safe to mutate). */
export const defaults = (): Config => structuredClone(DEFAULT);
