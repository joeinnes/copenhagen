// Small display helpers shared by the engine and the components.
export const pct = (x, d = 1) => (isFinite(x) ? (x * 100).toFixed(d) + '%' : '–');
export const hhmm = (m) => { m = ((Math.floor(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
export const mss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const fmtN = (n) => Math.round(n).toLocaleString('en-GB');
/** LED colour class for a wallboard figure against its target. */
export function cls(v, tgt, lowerBetter) { if (v == null || !isFinite(v)) return 'led-g'; const d = lowerBetter ? tgt - v : v - tgt; return d >= 0 ? 'led-g' : d > -0.05 ? 'led-a' : 'led-r'; }
