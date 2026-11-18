<script>
  // Step 2: what the desk has to handle and what you're promising, in one glance, with a way into each set of inputs.
  import { ui, S, CH, CHN, DOW, weeklyVol, activeLangs, langFrac, confAimTxt, ghostK, setDrawer } from '../engine.svelte.js';
  import { fmtN, mss } from '../format.js';
  import Section from './Section.svelte';

  const per = { day: 'a day', week: 'a week', month: 'a month' };
  function daysTxt(open) {
    const on = open.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    if (on.length === 7) return 'every day';
    if (!on.length) return 'no days';
    const run = on.every((d, k) => k === 0 || d === on[k - 1] + 1);
    return run && on.length > 2 ? `${DOW[on[0]]}–${DOW[on[on.length - 1]]}` : on.map((i) => DOW[i]).join(', ');
  }
  const aht = (c, s) => (c === 'voice' ? `${mss(s)} handle time` : `${Math.round((s / 60) * 10) / 10} min each${S.ch[c].conc > 1 ? `, ${S.ch[c].conc} at once` : ''}`);

  const b = $derived.by(() => {
    ui.inputs; ui.rev;
    const E = S.ch, on = CH.filter((c) => E[c].on);
    const hours = S.h24 ? '24 hours' : `${String(S.openFrom).padStart(2, '0')}:00–${String(S.openTo % 24).padStart(2, '0')}:00`;
    const shifts = ['9-hour shifts with lunch'];
    if (S.ptOn) shifts.push(`up to ${S.ptShare}% part-time (${S.ptHours}h)`);
    if (S.weLong) shifts.push(`${S.weLongHours || 12}-hour weekend shifts`);
    return {
      demand: on.map((c) => ({ c, name: CHN[c], vol: `${fmtN(E[c].vol)} ${per[S.period]}`, sub: aht(c, E[c].aht) })),
      open: `${hours}, ${daysTxt(S.openDays)}`,
      langs: activeLangs().map((l) => `${l.name} ${Math.round(langFrac(l.key) * 100)}%`).join(' · '),
      targets: on.map((c) => ({ c, name: CHN[c], t: c === 'email' || c === 'ticket' ? `${E[c].slPct}% within ${E[c].slHrs}h` : `${E[c].slPct}% in ${E[c].slSec}s` })),
      ab: E.voice.on && S.model === 'A' ? `at most ${S.abTarget}%` : null,
      aim: S.confOn ? confAimTxt() : 'Sized on the busiest forecast day',
      model: S.model === 'A' ? 'Erlang A, callers give up after ' + mss(E.voice.pat) : 'Erlang C, nobody gives up',
      head: S.autoSize ? 'Matched to the recommendation' : 'Set by hand',
      team: S.mode === 'blended' ? 'Blended: every team takes every channel' : 'Dedicated: one team per channel',
      shifts: shifts.join(', '),
      absence: `${S.shrink}% shrinkage · ${S.alDays} days leave · ${S.sickDays} sick`,
      min: S.minOn && !S.shared ? `At least ${S.minOnSeat} on seat, ${S.minPeople} per team` : S.shared ? 'Not applied (shared desk)' : 'Off',
      shared: S.shared ? `Shared by ${ghostK()} clients` : null,
    };
  });
</script>

<Section id="brief" n="2" name="Brief" title="What does the desk have to handle?" sub="The givens and the promises. Change anything here and the rest of the page updates.">
  <div class="brief">
    <article class="bcard">
      <header><h3>Demand</h3><span class="hint">The givens</span></header>
      <dl>
        {#each b.demand as d}<dt><span class="sw {d.c}"></span>{d.name}</dt><dd><b>{d.vol}</b><span>{d.sub}</span></dd>{/each}
        <dt>Open</dt><dd>{b.open}</dd>
        <dt>Languages</dt><dd>{b.langs}</dd>
      </dl>
      <button class="btn" id="openDemand" onclick={() => setDrawer('demand')}>Edit demand</button>
    </article>
    <article class="bcard">
      <header><h3>Service targets</h3><span class="hint">What you're selling</span></header>
      <dl>
        {#each b.targets as t}<dt><span class="sw {t.c}"></span>{t.name}</dt><dd><b>{t.t}</b></dd>{/each}
        {#if b.ab}<dt>Abandoned</dt><dd><b>{b.ab}</b></dd>{/if}
        <dt>Risk aim</dt><dd>{b.aim}</dd>
        <dt>Queue model</dt><dd>{b.model}</dd>
      </dl>
      <button class="btn" id="openTargets" onclick={() => setDrawer('targets')}>Edit targets</button>
    </article>
    <article class="bcard">
      <header><h3>Staffing</h3><span class="hint">How the desk is run</span></header>
      <dl>
        <dt>Headcount</dt><dd>{b.head}</dd>
        <dt>Teams</dt><dd>{b.team}</dd>
        <dt>Shifts</dt><dd>{b.shifts}</dd>
        <dt>Time away</dt><dd>{b.absence}</dd>
        <dt>Minimum</dt><dd>{b.min}</dd>
        {#if b.shared}<dt>Sharing</dt><dd>{b.shared}</dd>{/if}
      </dl>
      <button class="btn" id="openSetup" onclick={() => setDrawer('setup')}>Edit staffing</button>
    </article>
  </div>
</Section>
