<script>
  // "Will this rota hit target?": SLA risk scorecard, one card per metric, the period chart and service level by language.
  import { ui, S, CH, CHN, DEFER, DOW, MC, REC, live, sizing, activeLangs, langFrac, simMin, dayCover, setRepPeriod } from '../engine.svelte.js';
  import { pct, mss, fmtN, hhmm } from '../format.js';
  import { clamp } from '../../model';
  import { chartDay, chartWeek, chartMonth, DAY_GEOM } from '../charts.js';
  import Seg from './Seg.svelte';

  const NAME = { voice: 'call', chat: 'chat', email: 'email', ticket: 'ticket' };
  // While a period is simulating, the last result stays on screen (as before) under a "Simulating…" note.
  let last = null;
  const busy = $derived.by(() => { ui.mc; return !MC[ui.repPeriod]; });
  const d = $derived.by(() => {
    ui.mc; ui.rev; ui.live;
    const period = ui.repPeriod, r = MC[period];
    if (!r) return last;
    const E = S.ch, on = CH.filter((c) => E[c].on && r.exp.ch[c].off > 0), pname = { day: 'today', week: 'this week', month: 'this month' }[period];
    const unit = { day: 'days', week: 'weeks', month: 'months' }[period];
    const checks = on.map((c) => { const x = r.exp.ch[c]; return { c, p: r.P[c], name: NAME[c] + ' target', exp: x.sla / x.off, tgt: E[c].slPct / 100,
      tgtTxt: DEFER.includes(c) ? `${E[c].slPct}% within ${E[c].slHrs}h` : `${E[c].slPct}% in ${E[c].slSec}s` }; });
    if (E.voice.on && r.P.ab != null && S.model === 'A') { const x = r.exp.ch.voice; checks.push({ c: 'ab', p: r.P.ab, name: 'abandon limit', exp: x.ab / x.off, tgt: S.abTarget / 100, tgtTxt: `at most ${S.abTarget}%` }); }
    const worst = checks.reduce((w, x) => (!w || x.p < w.p ? x : w), null);
    const count = (p) => { const n = Math.round(p * 500); return n === 0 ? 'None' : n === 500 ? 'All' : String(n); };
    const expTxt = (w) => `Expected ${pct(w.exp)} against a target of ${w.tgtTxt}.`;
    const short = sizing(REC).tot.contract - sizing(S.hc).tot.contract;
    const fix = () => period === 'day' && live.incident ? 'The major incident is driving this. End it from the top bar, or add agents for the day.'
      : short > 0 ? `The rota is ${short} FTE short of the recommendation. Choose Use recommended in Desk set-up to close the gap.`
      : period === 'day' && live.sick.size && !live.replanned ? 'Absence is the likely cause. Try Replan remaining shifts in Desk set-up.'
      : 'Add agents in Desk set-up, or loosen the target in Demand & targets.';
    let vp;
    if (!worst) vp = 'Add some volume in Demand & targets.';
    else if (worst.p >= 0.8) vp = `The tightest is the ${worst.name}: ${count(worst.p) === 'All' ? 'all' : count(worst.p)} of 500 simulated ${unit} hit it. ${expTxt(worst)}`;
    else vp = `${count(worst.p)} of 500 simulated ${unit} hit the ${worst.name}. ${expTxt(worst)} ${fix()}`;
    const nRisk = checks.filter((x) => x.p < 0.8).length, nMiss = checks.filter((x) => x.p < 0.5).length, nAt = nRisk - nMiss;
    const head = !checks.length ? 'No SLA metrics to check' : nRisk === 0 ? `All ${checks.length} SLA metrics on track ${pname}` : `${nRisk} of ${checks.length} SLA metric${checks.length > 1 ? 's' : ''} at risk of penalty ${pname}`;
    const detail = nMiss && nAt ? [`${nMiss} likely to miss`, `${nAt} at risk`].join(', ') + '. ' : '';
    const dot = !checks.length ? 'var(--muted)' : nMiss ? 'var(--bad)' : nRisk ? 'var(--warn)' : 'var(--good)';
    const cards = [];
    for (const c of CH) {
      if (!E[c].on) continue; const x = r.exp.ch[c];
      const name = { voice: `Calls answered in ${E.voice.slSec}s`, chat: `Chats answered in ${E.chat.slSec}s`, email: `Emails replied in ${E.email.slHrs}h`, ticket: `Tickets resolved in ${E.ticket.slHrs}h` }[c];
      if (x.off <= 0) { cards.push({ c, name, p: null }); continue; }
      const sl = x.sla / x.off, t = E[c].slPct / 100, rows = [[`Offered ${pname}`, fmtN(x.off)]];
      if (c === 'voice') rows.push(['Average wait', mss(x.asa / x.off)], [S.model === 'A' ? 'Erlang C (no abandons)' : 'Erlang A (with abandons)', pct(x.slc / x.off)]);
      if (c === 'chat') rows.push(['Average wait', mss(x.asa / x.off)], ['Abandoned', S.model === 'A' ? pct(x.ab / x.off) : '–']);
      if (DEFER.includes(c)) rows.push([c === 'email' ? 'Replied late' : 'Resolved late', fmtN(x.off - x.sla)], ['Target clock', S.h24 ? '24 hours' : 'Opening hours']);
      cards.push({ c, name, p: r.P[c], val: sl, tgtTxt: `Target ${E[c].slPct}%`, gauge: { v: sl, t, lo: Math.max(0, Math.min(sl, t) - 0.2), hi: 1, lower: false }, rows });
      if (c === 'voice' && S.model === 'A') {
        const ab = x.ab / x.off, lim = S.abTarget / 100;
        cards.push({ c: 'voice', name: 'Abandoned calls', p: r.P.ab, val: ab, tgtTxt: `Limit ${S.abTarget}% of calls offered`, gauge: { v: ab, t: lim, lo: 0, hi: Math.max(lim * 2, ab * 1.15), lower: true },
          rows: [[`Calls lost ${pname}`, fmtN(x.ab)], ['Headroom', (lim - ab >= 0 ? '+' : '') + ((lim - ab) * 100).toFixed(1) + ' pts'], ['Caller patience', mss(S.ch.voice.pat)]] });
      }
    }
    const langs = activeLangs().map((l) => { const x = r.exp.lang[l.key]; return { name: l.name, share: Math.round(langFrac(l.key) * 100),
      cells: on.map((c) => { const y = x && x[c]; if (!y || y.off <= 0) return null; const v = y.sla / y.off; return { v, ok: v >= E[c].slPct / 100 }; }) }; });
    let chart;
    if (period === 'day') {
      const dc = dayCover(), showPlanned = !!(live.sick.size || live.leave.size);
      chart = { title: `Agents on seat vs required, ${DOW[live.dow]}`, planned: showPlanned, dc, voiceOn: E.voice.on,
        svg: chartDay({ ...dc, showPlanned, voice: E.voice, chat: E.chat, nowMin: simMin() }) };
    } else if (period === 'week') chart = { title: 'Expected service level by day', svg: chartWeek(S, r) };
    else chart = { title: 'Range of monthly outcomes', svg: chartMonth(S, r) };
    const occ = r.exp.avail > 0 ? r.exp.busy / r.exp.avail : 0;
    return (last = { period, pname, head, detail, vp, dot, occ, fte: sizing(S.hc).tot.contract, shrink: S.shrink, sick: live.sick.size, leave: live.leave.size, cards, langs, on, chart });
  });

  function pillTxt(p) { return p < 0.01 ? '<1%' : p > 0.99 ? '>99%' : Math.round(p * 100) + '%'; }
  const pillCls = (p) => (p >= 0.8 ? 'good' : p >= 0.5 ? 'warn' : 'bad');
  const sc = (g, x) => clamp((x - g.lo) / (g.hi - g.lo), 0, 1) * 100;

  // pointer tooltip on today's chart
  let tip = $state(null), chartEl = $state();
  function tipMove(e) {
    if (!d || d.period !== 'day') return;
    const svg = chartEl.querySelector('svg'); if (!svg) return;
    const { W, pl, pr } = DAY_GEOM, rc = svg.getBoundingClientRect(), px = (e.clientX - rc.left) * W / rc.width, i = Math.floor((px - pl) / ((W - pl - pr) / 48));
    if (i < 0 || i > 47 || e.clientY < rc.top || e.clientY > rc.bottom) { tip = null; return; }
    const { req, sch, V } = d.chart.dc, cr = chartEl.getBoundingClientRect();
    tip = { left: clamp(e.clientX - cr.left + 12, 0, cr.width - 190), top: e.clientY - cr.top - 60,
      lines: [`${hhmm(i * 30)}–${hhmm(i * 30 + 30)}`, `Required ${req[i].toFixed(1)} · On seat ${sch[i]}`, d.chart.voiceOn ? `Calls ${Math.round(V.off[i])} · SL ${V.off[i] > 0 ? pct(V.sla[i] / V.off[i], 0) : '–'}` : ''] };
  }
</script>

{#snippet pill(p)}
  {#if p == null}<span class="pill na">No volume</span>
  {:else}{@const c = pillCls(p)}<span class="pill {c}"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    {#if c === 'good'}<path d="M2 6l3 3 5-6"/>{:else if c === 'warn'}<path d="M6 2v5M6 9.5v.5"/>{:else}<path d="M3 3l6 6M9 3l-6 6"/>{/if}</svg>{pillTxt(p)} likely</span>{/if}
{/snippet}

<section class="report" aria-labelledby="repTitle">
  <div class="report-head">
    <h2 id="repTitle">Will this rota hit target?</h2>
    <Seg id="repSeg" label="Report period" value={ui.repPeriod} onpick={setRepPeriod} options={[['day', 'Today'], ['week', 'This week'], ['month', 'This month']]} />
  </div>
  {#if busy}<div class="verdict" id="verdict"><span class="busy">Simulating…</span></div>{/if}
  {#if d}
    <div class="scorecard" id="scorecard">
      <div class="eyebrow">SLA risk · {d.pname}</div>
      <h3 class="sc-title"><i style:background={d.dot}></i>{d.head}</h3>
      <p class="sc-text">{d.detail}{d.vp}</p>
      <div class="sc-facts"><span><b>{d.fte}</b>FTE rostered</span><span><b>{pct(d.occ, 0)}</b>occupancy</span><span><b>{d.shrink}%</b>shrinkage</span><span><b>{d.sick} / {d.leave}</b>off sick / on leave today</span></div>
    </div>
    <div class="cards" id="cards">
      {#each d.cards as k}
        <div class="mcard"><div class="card-top"><h3><span class="sw {k.c}"></span>{k.name}</h3>{@render pill(k.p)}</div>
          {#if k.gauge}
            {@const g = k.gauge}{@const ok = g.lower ? g.v <= g.t : g.v >= g.t}
            <div class="val">{pct(k.val)}</div><div class="tgt">{k.tgtTxt}</div>
            <div class="gauge" title="Expected {pct(g.v, 1)}, target {pct(g.t, 0)}"><i style:width="{sc(g, g.v)}%" style:background={ok ? 'var(--good)' : 'var(--bad)'}></i><b style:left="{sc(g, g.t)}%"></b></div>
            <div class="kv">{#each k.rows as [a, b]}<span>{a}</span><b>{b}</b>{/each}</div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="report-grid">
      <div class="chart" id="chart" bind:this={chartEl} role="presentation" onpointermove={tipMove} onpointerleave={() => (tip = null)}>
        <h3>{d.chart.title}</h3>
        {#if d.period === 'day'}
          <p class="sub"><span style="color:var(--accent)">■</span> Scheduled on seat &nbsp; <span style="font-family:var(--f-mono)">- -</span> Required for target (after shrinkage){#if d.chart.planned} &nbsp; <span style="font-family:var(--f-mono)">···</span> Planned before absence{/if}. Strips show call and chat service level per half hour.</p>
        {:else if d.period === 'week'}<p class="sub">Each day uses its own optimised rota. The dashed line is the target.</p>
        {:else}<p class="sub">500 simulated months with volumes varying around the forecast. Bars right of the target line are months that hit it.</p>{/if}
        {@html d.chart.svg}
        {#if tip}<div class="tip" id="tip" style:left="{tip.left}px" style:top="{tip.top}px">{tip.lines[0]}<br>{tip.lines[1]}<br>{tip.lines[2]}</div>{/if}
      </div>
      <div class="tbl" id="langTbl">
        <h3>Service level by language</h3><p class="hint" style="margin-bottom:8px">Expected {d.pname}, against each channel's target.</p>
        <table><tbody>
          <tr><th>Language</th>{#each d.on as c}<th>{CHN[c]}</th>{/each}</tr>
          {#each d.langs as l}<tr><td>{l.name} <span style="color:var(--muted)">{l.share}%</span></td>{#each l.cells as x}{#if x}<td class={x.ok ? 'ok' : 'miss'}>{pct(x.v)}</td>{:else}<td>–</td>{/if}{/each}</tr>{/each}
        </tbody></table>
      </div>
    </div>
  {/if}
  <p class="foot">Service level follows the contract basis set in Demand &amp; targets: abandoned calls either count as misses or are left out. The queue model is set in Demand &amp; targets: Erlang A models callers hanging up after their patience runs out; Erlang C assumes nobody ever hangs up. Each call card also shows the other model's figure for comparison. The likelihood figures come from 500 simulated periods with daily volumes varying around the forecast by the forecast accuracy you set. Rotas stay as planned in each run.</p>
</section>
