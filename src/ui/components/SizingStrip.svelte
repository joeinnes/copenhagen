<script>
  // The headline: how many agents this desk needs, and how sure we are.
  import { ui, S, REC, CONF, REC_WARN, sizing, clientShare, ghostK, attend, confAimTxt, confPeriodNow, pctAim } from '../engine.svelte.js';
  import { pct, fmtN } from '../format.js';
  const d = $derived.by(() => {
    ui.rev; ui.sizing;
    const need = sizing(REC), have = sizing(S.hc), share = clientShare(), shared = S.shared && share < 0.999;
    return { need, have, weLong: !!S.weLong, gap: have.tot.contract - need.tot.contract, shared, k: ghostK(), away: pct(1 - attend(), 1), autoSize: S.autoSize,
      headN: shared ? (need.tot.contract * share).toFixed(1) : need.tot.contract, both: need.nWD && need.nWE, warn: [...REC_WARN],
      conf: S.confOn ? { busy: CONF.busy, p: CONF.p, aim: confAimTxt(), unit: confPeriodNow() === 'week' ? 'weeks' : 'months', pctAim: pctAim() } : null };
  });
  const t = $derived(d.need.tot);
</script>

<div class="sizing" id="sizing" aria-label="Agents needed">
  <div><div class="eyebrow">{d.shared ? "This client's share" : 'Agents needed'}</div><div class="need"><span class="n">{d.headN}</span><span class="u">FTE</span></div></div>
  <div class="facts">
    <div class="fact"><b>{d.both ? `${t.wd} / ${t.we}` : d.need.nWD ? t.wd : t.we}</b><span>rostered per day{d.both ? ', weekdays / weekends' : ''}</span></div>
    <div class="fact"><b>~{d.need.nWD ? Math.round(t.inWd) : Math.round(t.inWe)}{d.both ? ' / ~' + Math.round(t.inWe) : ''}</b><span>typically in, after {d.away} leave and sickness</span></div>
    {#if d.weLong}<div class="fact"><b>{fmtN(t.hours)}</b><span>paid hours a week, 40 per FTE, long shifts at weekends</span></div>
    {:else}<div class="fact"><b>{fmtN(t.days)}</b><span>agent-days a week, 5 days each{t.ptw + t.pte ? `, ${t.ptw}${d.need.nWE ? ' / ' + t.pte : ''} part-time` : ''}</span></div>{/if}
    {#if d.shared}<div class="fact"><b>{t.contract}</b><span>FTE in the pool shared by {d.k} clients</span></div>{/if}
    {#if d.conf?.busy}<div class="fact"><b>…</b><span>finding the roster for {d.conf.aim}</span></div>
    {:else if d.conf && d.conf.p != null}<div class="fact"><b>{(d.conf.p * 100).toFixed(1)}%</b><span>of simulated {d.conf.unit} hit every target (aim {d.conf.pctAim}, {d.conf.aim})</span></div>{/if}
  </div>
  <div class="fact" style="justify-items:end;text-align:right">
    <b style:color={d.gap >= 0 ? 'var(--good)' : 'var(--bad)'}>{d.have.tot.contract} FTE rostered</b>
    <span>{d.autoSize ? 'Matched to the recommendation' : d.gap > 0 ? d.gap + ' more than needed' : d.gap === 0 ? 'Matches the recommendation' : -d.gap + ' short of the recommendation'}</span>
  </div>
  {#if d.warn.length}<p class="hint" style="grid-column:1/-1;color:var(--bad);margin:0">{d.warn.join(', ')}: the targets can't be met with 9-hour shifts in these opening hours, however many agents are added. Try a longer opening window, a looser target, or a longer email response time.</p>{/if}
</div>
