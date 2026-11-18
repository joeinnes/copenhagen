<script>
  // "How many agents do I need?": recommended headcount by team, and FTE for other call targets.
  import { ui, S, REC, CONF, TRADE, sizing, clientShare, ghostK, attend, confAimTxt, ptLen } from '../engine.svelte.js';
  import { pct, fmtN } from '../format.js';
  import Section from './Section.svelte';
  import SizingStrip from './SizingStrip.svelte';
  const d = $derived.by(() => {
    ui.rev; ui.sizing;
    const need = sizing(REC), E = S.ch, share = clientShare(), shared = S.shared && share < 0.999;
    const tg = [];
    if (E.voice.on) tg.push(`Calls ${E.voice.slPct}/${E.voice.slSec}s, ≤${S.abTarget}% abandoned`);
    if (E.chat.on) tg.push(`chats ${E.chat.slPct}/${E.chat.slSec}s`);
    if (E.email.on) tg.push(`emails ${E.email.slPct}% in ${E.email.slHrs}h`);
    if (E.ticket.on) tg.push(`tickets ${E.ticket.slPct}% in ${E.ticket.slHrs}h`);
    const basis = 'To hit: ' + tg.join(' · ') + (S.confOn ? ` · ${confAimTxt()}` : '') + (shared ? ` · ${Math.round(share * 100)}% share of a ${ghostK()}-client pool` : '');
    let trade = null;
    if (E.voice.on && TRADE && !TRADE.none) {
      const f0 = S.confOn && CONF.f ? CONF.f : 1, base = shared ? +(need.tot.contract * share).toFixed(1) : need.tot.contract;
      trade = { secs: TRADE.secs, rows: TRADE.pcts.map((p) => ({ p, cells: TRADE.secs.map((x) => {
        const raw = TRADE.res[p + '|' + x] * f0, f = shared ? +(raw * share).toFixed(1) : Math.round(raw), dd = +(f - base).toFixed(1);
        return { x, f, d: dd, cur: p === E.voice.slPct && x === E.voice.slSec };
      }) })) };
    }
    const longH = S.weLong ? S.weLongHours || 12 : 0;
    return { need, basis, shared, voiceOn: E.voice.on, trade, confOn: S.confOn, ptOn: S.ptOn, longH, ptFte: (ptLen() / 2 / 8).toFixed(2).replace(/0$/, ''),
      foot: `Sized on the busiest weekday and the busiest weekend day, each with its own optimised rota of ${longH ? `4h on, 1h lunch, 4h on (weekdays) and ${longH}-hour shifts (weekends)` : '4h on, 1h lunch, 4h on'}. On-shift numbers allow ${S.shrink}% shrinkage. Each agent takes ${S.alDays} days' annual leave and ${S.sickDays} sick days a year, so on any day each rostered agent has a ${pct(1 - attend(), 1)} chance of being away; rosters are sized up to cover that, and the ~ figures show who is typically in. ${longH ? `FTE is paid hours ÷ 40: a weekday shift pays 8 hours and a weekend shift ${longH}.` : 'FTE is agent-days ÷ 5.'} Each language team is sized on its own; spare language agents helping with English is a bonus on top.` };
  });
</script>

{#snippet row(lab, r, cls = '')}
  <tr class={cls}><td>{lab}</td>
    {#if d.need.nWD}<td>{r.wd}{#if r.ptw} <span style="color:var(--muted)">({r.ptw} PT)</span>{/if} <span style="color:var(--muted)">~{Math.round(r.inWd)}</span></td>{/if}
    {#if d.need.nWE}<td>{r.we}{#if r.pte} <span style="color:var(--muted)">({r.pte} PT)</span>{/if} <span style="color:var(--muted)">~{Math.round(r.inWe)}</span></td>{/if}
    <td>{fmtN(r.days)}</td><td><b>{r.contract}</b></td></tr>
{/snippet}

<Section id="headcount" n="3" name="Headcount" title="How many agents do I need?" sub="The smallest roster that hits every target in the brief, after rest days, leave and sickness.">
  <SizingStrip />
  <div class="sz-grid">
    <div class="tbl" id="szTeams">
      <h3>Recommended headcount by team</h3>
      <p class="hint" style="margin-bottom:8px">Agents rostered per day, including cover for leave and sickness, then FTE at {d.longH ? `paid hours ÷ 40, with ${d.longH}-hour weekend shifts` : '5 days in 7'}{d.ptOn ? `, with part-timers counting ${d.ptFte} FTE` : ''}.</p>
      <table><tbody>
        <tr><th>Team</th>{#if d.need.nWD}<th>Mon–Fri <span style="text-transform:none">(in)</span></th>{/if}{#if d.need.nWE}<th>Sat–Sun <span style="text-transform:none">(in)</span></th>{/if}<th>Agent-days / wk</th><th>FTE needed</th></tr>
        {#each d.need.rows as r}{@render row(r.t.label, r)}{/each}
        {@render row('Total', d.need.tot, 'tot')}
      </tbody></table>
    </div>
    <div class="tbl" id="szTrade">
      <h3>FTE needed for other call targets</h3>
      <p class="hint" style="margin-bottom:8px">Everything else held the same. The small figure is the difference from your current target.{d.confOn ? ' Scaled by the same confidence margin, so treat as approximate.' : ''}{d.shared ? " Shown as this client's share of the pool." : ''}</p>
      {#if !d.voiceOn}<p class="hint">Turn calls on to compare call targets.</p>
      {:else if !d.trade}<p class="busy">Working out the alternatives…</p>
      {:else}
        <table class="tgrid"><tbody>
          <tr><th>Answered</th>{#each d.trade.secs as x}<th>in {x}s</th>{/each}</tr>
          {#each d.trade.rows as r}<tr><th style="text-align:left">{r.p}%</th>{#each r.cells as c}<td class:cur={c.cur}>{c.f}<span style="color:var(--muted);font-size:11px">{c.d ? ` ${c.d > 0 ? '+' : ''}${c.d}` : ''}</span></td>{/each}</tr>{/each}
        </tbody></table>
      {/if}
    </div>
  </div>
  <details class="method"><summary>How this is worked out</summary><p class="foot" id="szFoot">{d.foot}</p></details>
</Section>
