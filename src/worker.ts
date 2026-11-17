/// <reference lib="webworker" />
// Runs the heavy simulation off the main thread, so the floor never stutters.
import * as M from './model';

export type SimRequest =
  | { id: number; type: 'conf'; S: M.Config; rec0: M.Rec; minh: M.Rec }
  | { id: number; type: 'trade'; S: M.Config }
  | { id: number; type: 'mc'; S: M.Config; hc: M.Rec; period: 'week' | 'month' };

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const req = e.data;
  try {
    let out: unknown;
    if (req.type === 'conf') out = M.searchConfidence(M.makeCtx(req.S), req.rec0, req.minh);
    else if (req.type === 'trade') out = M.tradeGrid(req.S);
    else {
      const ctx = M.makeCtx(req.S), plan = M.computePlans(ctx, req.hc);
      out = M.runMC(ctx, { period: req.period, hc: req.hc, plan });
    }
    (self as unknown as Worker).postMessage({ id: req.id, out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: req.id, error: String(err) });
  }
};
