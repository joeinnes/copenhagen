<script>
  // The wallboard above the floor: today and month to date, in whole contacts. Refreshes with the clock.
  import { ui, S, DOW, MONTH_DAYS, wallboardData, tickerText } from '../engine.svelte.js';
  import { pct, hhmm, mss, fmtN, cls } from '../format.js';
  const w = $derived.by(() => { ui.tick; ui.live; ui.rev; return wallboardData(performance.now() / 1000); });
  const ticker = $derived.by(() => { ui.mc; ui.live; ui.tick; return tickerText(); });
  const rt = (x, k) => (x.off > 0 ? x[k] / x.off : null);
  const show = (v, d = 1) => (v == null ? '––' : pct(v, d));
  const E = $derived.by(() => { ui.tick; ui.rev; return { ch: S.ch, shared: S.shared, model: S.model, abTarget: S.abTarget }; });
</script>

<section class="wallboard" aria-label="Wallboard">
  <div class="wb-grid" id="wb">
    {#if w}
      {@const td = w.td}{@const mt = w.mt}{@const V = E.ch.voice}
      {@const vsl = rt(td.voice, 'sla')}{@const vab = rt(td.voice, 'ab')}{@const csl = rt(td.chat, 'sla')}
      {@const mVsl = rt(mt.voice, 'sla')}{@const mVab = rt(mt.voice, 'ab')}{@const mCsl = rt(mt.chat, 'sla')}{@const mEsl = rt(mt.email, 'sla')}{@const mTsl = rt(mt.ticket, 'sla')}
      {#if w.incident}
        <div class="wb-cell wide alert"><div class="wb-label" style="color:#ff8a7a">Status</div><div class="wb-val led-r blink">MAJOR INCIDENT</div>
          <div class="wb-sub" style="color:#ffb0a5">Call volume doubled since {hhmm(w.incident.from * 30)}{w.incident.to < 48 ? ` · ends ${hhmm(w.incident.to * 30)}` : ''}</div></div>
      {/if}
      <div class="wb-cell"><div class="wb-label">{DOW[w.dow]} · Interval</div><div class="wb-val led-a">{hhmm(w.m)}</div><div class="wb-sub">{hhmm(w.i * 30)}–{hhmm(w.i * 30 + 30)}</div></div>
      {#if V.on}
        <div class="wb-cell"><div class="wb-label">Calls waiting{E.shared ? ' · pool' : ''}</div><div class="wb-val {w.waiting > 5 ? 'led-r' : w.waiting > 1 ? 'led-a' : 'led-g'}">{w.waiting}</div><div class="wb-sub">Longest {mss(w.longest)}</div></div>
        <div class="wb-cell"><div class="wb-label">Calls SL today</div><div class="wb-val {cls(vsl, V.slPct / 100)}">{show(vsl)}</div><div class="wb-sub">Tgt {V.slPct}/{V.slSec}s · {w.langs}</div></div>
        <div class="wb-cell"><div class="wb-label">Calls SL month to date</div><div class="wb-val {cls(mVsl, V.slPct / 100)}">{show(mVsl)}</div><div class="wb-sub">Day {w.mtdDay} of {MONTH_DAYS} · {fmtN(mt.voice.off)} offered</div></div>
        <div class="wb-cell wide"><div class="wb-label">Calls today · MTD {fmtN(mt.voice.off - mt.voice.ab)} handled</div><div class="wb-trio">
          <div><span class="wb-val led-g">{fmtN(td.voice.off)}</span><span class="wb-sub">offered</span></div>
          <div><span class="wb-val led-g">{fmtN(td.voice.off - td.voice.ab)}</span><span class="wb-sub">handled</span></div>
          <div><span class="wb-val led-g">{fmtN(td.voice.sla)}</span><span class="wb-sub">in {V.slSec}s</span></div>
          <div><span class="wb-val {td.voice.ab > 0.5 ? 'led-a' : 'led-g'}">{fmtN(td.voice.ab)}</span><span class="wb-sub">abandoned</span></div>
        </div></div>
        <div class="wb-cell"><div class="wb-label">Abandoned</div><div class="wb-val {cls(vab, E.abTarget / 100, true)}">{show(vab)}</div>
          <div class="wb-sub">{#if E.model === 'C'}Erlang C: none modelled{:else}Max {E.abTarget}% · MTD <span class={cls(mVab, E.abTarget / 100, true)}>{show(mVab)}</span> · {fmtN(mt.voice.ab)} lost{/if}</div></div>
      {/if}
      {#if E.ch.chat.on}
        <div class="wb-cell"><div class="wb-label">Chats waiting{E.shared ? ' · pool' : ''}</div><div class="wb-val {w.cw > 4 ? 'led-r' : w.cw > 1 ? 'led-a' : 'led-g'}">{w.cw}</div>
          <div class="wb-sub">SL today {show(csl, 0)} · MTD <span class={cls(mCsl, E.ch.chat.slPct / 100)}>{show(mCsl, 0)}</span> · tgt {E.ch.chat.slPct}%<br>{fmtN(td.chat.off)} chat{td.chat.off === 1 ? '' : 's'} so far</div></div>
      {/if}
      {#each [['email', 'Email queue', w.emailBacklog, mEsl], ['ticket', 'Ticket queue', w.ticketBacklog, mTsl]] as [c, label, bl, msl]}
        {#if E.ch[c].on}
          {@const esl = rt(td[c], 'sla')}
          <div class="wb-cell"><div class="wb-label">{label}</div><div class="wb-val {cls(esl, E.ch[c].slPct / 100)}">{Math.round(bl)}</div>
            <div class="wb-sub">{esl == null ? 'Today –– (' + td[c].off + ' in)' : 'Today ' + pct(esl, 0) + ' in ' + E.ch[c].slHrs + 'h'} · MTD <span class={cls(msl, E.ch[c].slPct / 100)}>{show(msl, 0)}</span> · tgt {E.ch[c].slPct}%</div></div>
        {/if}
      {/each}
      {@const n = w.cnt}
      <div class="wb-cell wide"><div class="wb-label">Agents</div><div class="wb-agents">
        {#if V.on}<span><b>CALL</b>{n.voice}</span>{/if}{#if E.ch.chat.on}<span><b>CHAT</b>{n.chat}</span>{/if}{#if E.ch.email.on}<span><b>MAIL</b>{n.email}</span>{/if}{#if E.ch.ticket.on}<span><b>TKT</b>{n.ticket}</span>{/if}
        <span><b>READY</b>{n.idle}</span><span class="led-a"><b>BRK</b>{n.brk}</span><span class="led-a"><b>LUNCH</b>{n.lunch}</span><span class:led-r={n.sick}><b>SICK</b>{n.sick}</span><span><b>LEAVE</b>{n.leave}</span>
      </div></div>
    {/if}
  </div>
  <div class="ticker"><div id="ticker">{ticker}</div></div>
</section>
