// Talks to the simulation worker. Falls back to running on the main thread if workers aren't available.
import * as M from '../model';
import SimWorker from '../worker.ts?worker&inline';

type Payload =
  | { type: 'conf'; S: M.Config; rec0: M.Rec; minh: M.Rec }
  | { type: 'trade'; S: M.Config }
  | { type: 'mc'; S: M.Config; hc: M.Rec; period: 'week' | 'month' };

let worker: Worker | null = null;
try { worker = new SimWorker(); } catch { worker = null; }
let nextId = 1;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
if (worker) {
  worker.onmessage = (e: MessageEvent<{ id: number; out?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.rej(new Error(e.data.error)); else p.res(e.data.out);
  };
  worker.onerror = () => { worker = null; for (const [, p] of pending) p.rej(new Error('worker failed')); pending.clear(); };
}

function runHere(p: Payload): unknown {
  if (p.type === 'conf') return M.searchConfidence(M.makeCtx(p.S), p.rec0, p.minh);
  if (p.type === 'trade') return M.tradeGrid(p.S);
  const ctx = M.makeCtx(p.S);
  return M.runMC(ctx, { period: p.period, hc: p.hc, plan: M.computePlans(ctx, p.hc) });
}

/** Run a simulation job; the scenario is copied, so later edits on the page can't leak into a running job. */
export function sim<T>(p: Payload): Promise<T> {
  const msg = JSON.parse(JSON.stringify(p));
  if (!worker) return new Promise((res) => setTimeout(() => res(runHere(msg) as T), 0));
  const id = nextId++;
  return new Promise<T>((res, rej) => {
    pending.set(id, { res, rej });
    worker!.postMessage({ id, ...msg });
  }).catch(() => runHere(msg) as T);
}

export const usingWorker = () => !!worker;
