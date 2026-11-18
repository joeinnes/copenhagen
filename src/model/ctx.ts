import type { Config } from './types';
import type { ErlangOpts } from './erlang';

/**
 * A model context: one scenario plus memo tables that are only valid for it.
 * Make a new context whenever the scenario changes (the page does this on every recompute).
 */
export interface Ctx {
  S: Config;
  memo: Map<string, unknown>;
  planMemo: Map<string, number[]>;
  erl: ErlangOpts;
  /** Place shifts purely on cover, ignoring start-time preferences (set when sociable starts would cost headcount). */
  plainPlans?: boolean;
}

export function makeCtx(S: Config): Ctx {
  return { S, memo: new Map(), planMemo: new Map(), erl: { model: S.model, slBasis: S.slBasis, shortAb: S.shortAb } };
}

export function cached<T>(ctx: Ctx, key: string, fn: () => T): T {
  if (ctx.memo.has(key)) return ctx.memo.get(key) as T;
  const v = fn();
  ctx.memo.set(key, v);
  return v;
}
