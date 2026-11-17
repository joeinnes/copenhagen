// SVG chart builders. Pure functions: data in, SVG markup out. The components place them and add any interaction.
import { CH, CHN, DOW, clamp } from '../model';
import { pct, hhmm } from './format.js';

const svgEl = (w, h, inner, style = '') => `<svg viewBox="0 0 ${w} ${h}" role="img"${style ? ` style="${style}"` : ''}>${inner}</svg>`;
const stepPath = (arr, x, y) => { let d = `M${x(0)},${y(arr[0])}`; for (let i = 0; i < 48; i++) { d += `H${x(i + 1)}`; if (i < 47) d += `V${y(arr[i + 1])}`; } return d; };

/** Today: agents on seat against the requirement, with per-interval service level strips and a "now" line. */
export const DAY_GEOM = { W: 760, H: 250, pl: 34, pr: 8, pt: 10, pb: 46 };
export function chartDay({ req, sch, pln, showPlanned, V, C, voice, chat, nowMin }) {
  const { W, H, pl, pr, pt, pb } = DAY_GEOM;
  const mx = Math.max(4, ...req, ...sch, ...pln) * 1.1, x = (i) => pl + (W - pl - pr) * i / 48, y = (v) => pt + (H - pt - pb) * (1 - v / mx), ch = H - pb;
  let g = ''; const step = mx > 40 ? 10 : mx > 16 ? 5 : 2;
  for (let v = 0; v <= mx; v += step) g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`;
  for (let hh = 0; hh <= 24; hh += 3) g += `<text class="ax" x="${x(hh * 2)}" y="${ch + 40}" text-anchor="middle">${String(hh % 24).padStart(2, '0')}:00</text>`;
  g += `<path d="${stepPath(sch, x, y)}V${ch}H${x(0)}Z" fill="var(--accent)" opacity=".22"/><path d="${stepPath(sch, x, y)}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  if (showPlanned) g += `<path d="${stepPath(pln, x, y)}" fill="none" stroke="var(--ink-2)" stroke-width="1.2" stroke-dasharray="2 3"/>`;
  g += `<path d="${stepPath(req, x, y)}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 4"/>`;
  const strip = (arr, off, tg, yy, lab) => {
    let s = `<text class="ax" x="${pl - 6}" y="${yy + 7}" text-anchor="end">${lab}</text>`;
    for (let i = 0; i < 48; i++) { if (off[i] <= 0.01) continue; const v = arr[i] / off[i], c = v >= tg ? 'var(--good)' : v >= tg - 0.1 ? 'var(--warn)' : 'var(--bad)'; s += `<rect x="${x(i) + 0.5}" y="${yy}" width="${x(1) - x(0) - 1}" height="9" rx="1.5" fill="${c}"/>`; }
    return s;
  };
  if (voice.on) g += strip(V.sla, V.off, voice.slPct / 100, ch + 6, 'SL');
  if (chat.on) g += strip(C.sla, C.off, chat.slPct / 100, ch + 18, 'Chat');
  const nx = x(nowMin / 30); g += `<line x1="${nx}" x2="${nx}" y1="${pt}" y2="${ch + 28}" stroke="var(--bad)" stroke-width="1.5"/><text class="lbl" x="${nx + 4}" y="${pt + 10}">now</text>`;
  g += `<rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt}" fill="transparent"/>`;
  return svgEl(W, H, g);
}

/** This week: expected service level per day and channel. */
export function chartWeek(S, r) {
  const E = S.ch, on = CH.filter((c) => E[c].on), W = 760, rowH = 78, H = on.length * rowH + 24, pl = 70, pr = 8; let g = '';
  const bw = (W - pl - pr) / 7;
  on.forEach((c, ri) => {
    const y0 = ri * rowH + 6, hh = rowH - 26, tg = E[c].slPct / 100, lo = Math.min(0.5, tg - 0.2), yy = (v) => y0 + hh * (1 - (clamp(v, lo, 1) - lo) / (1 - lo));
    g += `<text class="lbl" x="0" y="${y0 + 12}">${CHN[c]}</text><text class="ax" x="0" y="${y0 + 26}">tgt ${E[c].slPct}%</text><text class="ax" x="${pl - 6}" y="${yy(1) + 4}" text-anchor="end">100%</text><text class="ax" x="${pl - 6}" y="${yy(lo)}" text-anchor="end">${Math.round(lo * 100)}%</text><line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy(lo)}" y2="${yy(lo)}"/>`;
    r.exp.perDay.forEach((d, i) => {
      const x = d[c]; if (x.off <= 0) return; const v = x.sla / x.off, bx = pl + i * bw + bw * 0.2, top = yy(v);
      g += `<rect x="${bx}" y="${top}" width="${bw * 0.6}" height="${Math.max(1, yy(lo) - top)}" rx="3" fill="var(--ch-${c})"><title>${DOW[i]}: ${pct(v)}</title></rect>`;
      if (i === 0 || v < tg) g += `<text class="ax" x="${bx + bw * 0.3}" y="${top - 4}" text-anchor="middle">${Math.round(v * 100)}</text>`;
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${yy(tg)}" y2="${yy(tg)}" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="5 4"/>`;
  });
  for (let i = 0; i < 7; i++) g += `<text class="ax" x="${pl + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${DOW[i]}</text>`;
  return svgEl(W, H, g);
}

/** This month: histogram of the 500 simulated months per channel. */
export function chartMonth(S, r) {
  const E = S.ch, on = CH.filter((c) => E[c].on && r.samples[c].length), W = 760, rowH = 80, H = on.length * rowH + 10, pl = 70, pr = 8; let g = '';
  on.forEach((c, ri) => {
    const sm = r.samples[c], tg = E[c].slPct / 100, lo = Math.min(tg - 0.1, Math.min(...sm)), hi = Math.max(tg + 0.05, Math.max(...sm)), nb = 30, bins = new Array(nb).fill(0);
    sm.forEach((v) => bins[clamp(Math.floor((v - lo) / (hi - lo) * nb), 0, nb - 1)]++);
    const mxb = Math.max(...bins), y0 = ri * rowH + 8, hh = rowH - 30, bw = (W - pl - pr) / nb, xx = (v) => pl + (v - lo) / (hi - lo) * (W - pl - pr);
    g += `<text class="lbl" x="0" y="${y0 + 12}">${CHN[c]}</text><text class="ax" x="0" y="${y0 + 26}">${r.P[c] < 0.01 ? '<1%' : r.P[c] > 0.99 ? '>99%' : Math.round(r.P[c] * 100) + '%'} hit</text>`;
    bins.forEach((b, i) => { if (!b) return; const bx = pl + i * bw, bh = b / mxb * hh, mid = lo + (i + 0.5) / nb * (hi - lo); g += `<rect x="${bx + 1}" y="${y0 + hh - bh}" width="${bw - 2}" height="${bh}" rx="2" fill="${mid >= tg ? 'var(--ch-' + c + ')' : 'var(--muted)'}" opacity="${mid >= tg ? 1 : 0.55}"/>`; });
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y0 + hh}" y2="${y0 + hh}"/><line x1="${xx(tg)}" x2="${xx(tg)}" y1="${y0}" y2="${y0 + hh + 4}" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="4 3"/>
      <text class="ax" x="${pl}" y="${y0 + hh + 14}">${pct(lo, 0)}</text><text class="ax" x="${W - pr}" y="${y0 + hh + 14}" text-anchor="end">${pct(hi, 0)}</text><text class="ax" x="${xx(tg)}" y="${y0 + hh + 14}" text-anchor="middle">target</text>`;
  });
  return svgEl(W, H, g);
}

const SH_W = 940, SH_PL = 150, SH_PR = 10;
function segs(a, b) { const out = [], len = b - a; a = ((a % 1440) + 1440) % 1440; b = a + len; if (b <= 1440) out.push([a, b]); else { out.push([a, 1440]); out.push([0, b - 1440]); } return out; }

/** Shift schedule: one row per start time, bar per working block. */
export function shiftGantt({ groups, multiTeam, shS, shPT, shSegs, shLabel }) {
  const W = SH_W, pl = SH_PL, pr = SH_PR, top = 22, rh = 22, H = top + Math.max(1, groups.length) * rh + 6, x = (m) => pl + (W - pl - pr) * m / 1440, mxN = Math.max(1, ...groups.map((z) => z.n)); let g = '';
  for (let h = 0; h <= 24; h += 2) g += `<line class="grid" x1="${x(h * 60)}" x2="${x(h * 60)}" y1="${top - 4}" y2="${H}"/><text class="ax" x="${x(h * 60)}" y="12" text-anchor="middle">${String(h % 24).padStart(2, '0')}:00</text>`;
  groups.forEach((o, r) => {
    const y = top + r * rh + 3, s0 = shS(o.s) * 30, pt = shPT(o.s), bh = rh - 7, br = Object.entries(o.by).map(([k, v]) => `${k} ${v}`).join(', ');
    g += `<g><title>${pt ? 'Part-time ' + shLabel(o.s) : `${hhmm(s0)}–${hhmm(s0 + 540)}, lunch ${hhmm(s0 + 240)}–${hhmm(s0 + 300)}`}: ${o.n} agent${o.n > 1 ? 's' : ''}${multiTeam ? ' (' + br + ')' : ''}</title>`;
    g += `<rect x="0" y="${y - 2}" width="${W}" height="${rh - 2}" fill="transparent"/>`;
    g += `<text class="lbl" x="0" y="${y + bh - 3}">${shLabel(o.s)}${pt ? ' PT' : ''}</text><text class="ax" x="${pl - 8}" y="${y + bh - 3}" text-anchor="end" style="font-weight:600">×${o.n}</text>`;
    for (const [a, b, lun] of shSegs(o.s)) for (const [p, q] of segs(a, b))
      g += `<rect x="${x(p) + (lun ? 0 : 1)}" y="${y}" width="${Math.max(1, x(q) - x(p) - (lun ? 0 : 2))}" height="${bh}" rx="${lun ? 0 : 3}" fill="${lun ? 'var(--muted)' : 'var(--accent)'}" opacity="${lun ? 0.35 : 0.35 + 0.65 * o.n / mxN}"/>`;
    g += '</g>';
  });
  if (!groups.length) g += `<text class="lbl" x="${pl}" y="${top + 14}">No shifts on this day.</text>`;
  return svgEl(W, H, g, 'min-width:640px');
}

/** Shift schedule: agents on seat against the requirement, shortfall in red. */
export function shiftCover(req, on) {
  const W = SH_W, pl = SH_PL, pr = SH_PR, CH2 = 200, pb = 24, pt = 8, mx = Math.max(3, ...req, ...on) * 1.1, yy = (v) => pt + (CH2 - pt - pb) * (1 - v / mx), xx = (i) => pl + (W - pl - pr) * i / 48; let c = '';
  const step = mx > 40 ? 10 : mx > 16 ? 5 : 2;
  for (let v = 0; v <= mx; v += step) c += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy(v)}" y2="${yy(v)}"/><text class="ax" x="${pl - 6}" y="${yy(v) + 3.5}" text-anchor="end">${v}</text>`;
  for (let h = 0; h <= 24; h += 2) c += `<text class="ax" x="${xx(h * 2)}" y="${CH2 - 6}" text-anchor="middle">${String(h % 24).padStart(2, '0')}:00</text>`;
  c += `<path d="${stepPath(on, xx, yy)}V${yy(0)}H${xx(0)}Z" fill="var(--accent)" opacity=".2"/><path d="${stepPath(on, xx, yy)}" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="${stepPath(req, xx, yy)}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 4"/>`;
  for (let i = 0; i < 48; i++) if (req[i] - on[i] > 0.5) c += `<rect x="${xx(i)}" y="${yy(req[i])}" width="${xx(1) - xx(0)}" height="${yy(on[i]) - yy(req[i])}" fill="var(--bad)" opacity=".3"/>`;
  return svgEl(W, CH2, c, 'min-width:640px');
}
