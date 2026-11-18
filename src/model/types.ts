// Shared types for the Copenhagen model.

export type Channel = 'voice' | 'chat' | 'email' | 'ticket';
export type DeferredChannel = 'email' | 'ticket';

export interface ChannelConfig {
  on: boolean;
  vol: number;          // contacts per entry period (day / week / month)
  aht: number;          // average handle time, seconds
  slPct: number;        // service level target, % (0-100)
  slSec?: number;       // live channels: answer within this many seconds
  slHrs?: number;       // deferred channels: resolve within this many (open) hours
  pat?: number;         // live channels: average patience before abandoning, seconds
  conc: number;         // contacts handled at once per agent
  curve: number[];      // 24 hourly weights
}

export interface Language { name: string; share: number; on: boolean }
export interface Headcount { wd: number; we: number }

/** The whole scenario, exactly as the page stores and shares it. */
export interface Config {
  period: 'day' | 'week' | 'month';
  openDays: boolean[];
  h24: boolean;
  openFrom: number;
  openTo: number;
  dayW: number[];
  fcErr: number;
  ch: Record<Channel, ChannelConfig>;
  langs: Language[];
  mode: 'blended' | 'dedicated';
  hc: Record<string, Headcount>;
  shrink: number;
  spare: boolean;
  abTarget: number;
  slBasis: 'offered' | 'short' | 'answered';
  shortAb: number;
  model: 'A' | 'C';
  name: string;
  autoSize: boolean;
  alDays: number;
  sickDays: number;
  minOn: boolean;
  minOnSeat: number;
  minPeople: number;
  ptOn: boolean;
  ptHours: number;
  ptShare: number;
  /** Full-time agents work long shifts (weLongHours) at weekends instead of 9-hour ones. */
  weLong?: boolean;
  weLongHours?: number;
  /** Prefer sociable shift start times when the rota can keep the same cover. */
  shiftPrefs?: boolean;
  /** Half hours (0-47) when no shift may start. */
  noStart?: number[];
  shared: boolean;
  clients: number;
  confOn: boolean;
  conf: number;
  confPeriod: 'month' | 'week';
  confMode: 'misses' | 'clean' | 'pct';
  contractMonths: number;
  missesAllowed: number;
  cleanChance: number;
}

export interface Team {
  id: string;
  lang: string;
  langName: string;
  chs: Channel[];
  label: string;
  sub: string;
}

export interface ErlangResult {
  sl: number;   // share answered within the threshold (on the contract's basis)
  ab: number;   // share abandoned
  pw: number;   // probability of waiting
  lq: number;   // mean queue length
  asa: number;  // mean wait across all arrivals, seconds
  occ: number;  // occupancy of the servers
  unstable?: boolean;
}

export type Plan = Record<number, Record<string, number[]>>;          // day -> team -> shift codes
export type Sched = Record<string, Float64Array>;                       // team -> agents on seat per half hour
export type Rec = Record<string, Headcount>;                            // team -> agents rostered per day type
