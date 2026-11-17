<script>
  // Demand & targets: the queue model, service targets and the contract aim, then volumes, hours and patterns.
  import { ui, S, CH, CHN, DOW, weeklyVol, isOpenIv, confAimTxt, confPeriodNow, pctAim, setDrawer, setPeriod, setConfMode, setModel, toggleOpenDay, applyPreset, setLang, changed } from '../engine.svelte.js';
  import { pct, fmtN } from '../format.js';
  import Num from './Num.svelte';
  import Check from './Check.svelte';
  import Sel from './Sel.svelte';
  import Seg from './Seg.svelte';
  import BarEditor from './BarEditor.svelte';

  let closeEl, curveCh = $state('voice'), presetEl;
  $effect(() => { if (ui.drawer === 'demand') setTimeout(() => closeEl?.focus(), 50); });

  const v = $derived.by(() => {
    ui.inputs; ui.rev;
    const others = S.langs.slice(1).filter((l) => l.on).reduce((a, l) => a + (+l.share || 0), 0);
    return {
      S, model: S.model, period: S.period, per: { day: 'day', week: 'week', month: 'month' }[S.period], h24: S.h24, slBasis: S.slBasis, confMode: S.confMode,
      openDays: S.openDays.slice(), langs: S.langs.map((l) => ({ ...l })), rest: Math.max(0, 100 - others),
      periodHint: `${S.period === 'day' ? 'Per open day. ' : ''}That's about ${CH.map((c) => (S.ch[c].on ? `${fmtN(weeklyVol(c) / 7)} ${CHN[c].toLowerCase()}` : null)).filter(Boolean).join(', ')} on an average day.`,
      confPct: S.confMode === 'pct', confUnit: confPeriodNow() === 'week' ? 'week' : 'month', aim: confAimTxt().replace(/^./, (c) => c.toUpperCase()), pctAim: pctAim(),
    };
  });
  const isC = $derived(v.model === 'C');
  const hours = [...Array(25).keys()];
  const basisHint = { offered: 'The strictest reading. Every caller who gives up counts against you.', short: 'Common in contracts. Callers who hang up almost straight away are treated as not really waiting.', answered: 'Flatters the number. When the queue is overloaded, callers who give up stop counting against you, so understaffing can still look on target. The abandon limit is the only safeguard.' };
  const curveLabels = Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? String(i).padStart(2, '0') : ''));
</script>

{#snippet chHead(c, label)}<h3><span class="sw {c}"></span>{label}</h3>{/snippet}

<aside class="drawer left" class:open={ui.drawer === 'demand'} id="demand" aria-label="Demand and targets" aria-hidden={ui.drawer !== 'demand'}>
  <header><div><h2>Demand &amp; targets</h2><p>What customers send you, and the service you promise</p></div><button class="x" bind:this={closeEl} aria-label="Close" onclick={() => setDrawer(null)}>×</button></header>
  <div class="drawer-body">
    <div class="part"><span>Queue model</span><p>The maths behind every number on the page.</p></div>
    <section class="grp">
      <Seg id="modelSeg" label="Queue model" value={v.model} onpick={setModel} options={[['A', 'Erlang A'], ['C', 'Erlang C']]} />
      <p class="hint" id="modelHint">{v.model === 'A' ? 'Callers hang up when their patience runs out, which shortens the queue for everyone else. More realistic, and gives an abandon rate.' : 'Assumes nobody ever hangs up. More conservative, so it asks for more agents, and it is what many WFM tools and contracts quote. Patience and abandon settings are ignored.'}</p>
    </section>
    <div class="part"><span>Service targets</span><p>What you're selling. Tighter targets need more agents.</p></div>
    <section class="grp">
      <h3>How sure do you need to be?</h3>
      <label class="inline"><Check k="confOn" id="confOn" /> Size against SLA penalty risk over the contract</label>
      <div class="inline">Contract length <Num k="contractMonths" id="contractMonths" min="1" max="240" step="1" style="width:70px" /> months <span class="hint">(5 + 1 + 1 years = 84)</span></div>
      <div class="cf-opts" role="radiogroup" aria-label="Aim">
        <label class="inline"><input type="radio" name="confMode" value="misses" checked={v.confMode === 'misses'} onchange={() => setConfMode('misses')}> At most <Num k="missesAllowed" id="missesAllowed" min="0" max="24" step="1" style="width:56px" /> missed month(s) over the contract</label>
        <label class="inline"><input type="radio" name="confMode" value="clean" checked={v.confMode === 'clean'} onchange={() => setConfMode('clean')}> A <Num k="cleanChance" id="cleanChance" min="1" max="99.9" step="0.1" style="width:64px" /> % chance of no missed month at all</label>
        <label class="inline"><input type="radio" name="confMode" value="pct" checked={v.confMode === 'pct'} onchange={() => setConfMode('pct')}> Every target met in <Num k="conf" id="conf" min="50" max="100" step="0.1" style="width:64px" /> % of <Sel k="confPeriod" id="confPeriod" str style="width:auto" aria-label="Period"><option value="month">months</option><option value="week">weeks</option></Sel></label>
      </div>
      <p class="cf-out" id="confOut">{#if v.confPct}Each {v.confUnit} must hit every target with <b>{v.pctAim}</b> probability.{:else}{v.aim} means each month must hit every target with <b>{v.pctAim}</b> probability.{/if}</p>
      <p class="hint">The tool searches for the smallest roster that hits every target in that share of 500 simulated months, with volume and absence varying. 500 months can't tell 99.8% from 100%, so aims above that need every simulated month to pass. Off: the roster is sized on the forecast for the busiest day.</p>
    </section>
    <section class="grp">
      {@render chHead('voice', 'Calls')}
      <div class="inline">Answer <Num k="ch.voice.slPct" id="vPct" min="1" max="99" /> % within <Num k="ch.voice.slSec" id="vSec" min="1" max="600" /> s</div>
      <div class="inline">Abandoned calls at most <Num k="abTarget" id="abT" min="0" max="50" step="0.5" disabled={isC} /> %</div>
    </section>
    <section class="grp">
      <h3>Abandoned contacts in the service level</h3>
      <Sel k="slBasis" id="slBasis" str disabled={isC}>
        <option value="offered">Count as misses (share of all offered)</option>
        <option value="short">Exclude short abandons only</option>
        <option value="answered">Exclude all abandons (share of answered)</option>
      </Sel>
      <div class="inline" id="shortRow" style:display={v.slBasis === 'short' ? 'flex' : 'none'}>Short means they hung up within <Num k="shortAb" id="shortAb" min="1" max="60" disabled={isC} /> s</div>
      <p class="hint" id="basisHint">{basisHint[v.slBasis]}</p>
    </section>
    <section class="grp">
      {@render chHead('chat', 'Chats')}
      <div class="inline">Answer <Num k="ch.chat.slPct" id="cPct" min="1" max="99" /> % within <Num k="ch.chat.slSec" id="cSec" min="1" max="900" /> s</div>
    </section>
    <section class="grp">
      {@render chHead('email', 'Emails')}
      <div class="inline">Reply to <Num k="ch.email.slPct" id="ePct" min="1" max="99" /> % within <Num k="ch.email.slHrs" id="eHrs" min="1" max="72" /> hours</div>
    </section>
    <section class="grp">
      {@render chHead('ticket', 'Self-service tickets')}
      <div class="inline">Resolve <Num k="ch.ticket.slPct" id="tPct" min="1" max="99" /> % within <Num k="ch.ticket.slHrs" id="tHrs" min="1" max="120" /> hours</div>
    </section>

    <div class="part"><span>Demand</span><p>The givens: volumes, handle times and when contacts arrive.</p></div>
    <section class="grp">
      <h3>Customer patience</h3>
      <div class="fields">
        <label class="field"><span>Callers wait on average (s)</span><Num k="ch.voice.pat" id="vPat" min="5" step="5" disabled={isC} /></label>
        <label class="field"><span>Chat customers wait on average (s)</span><Num k="ch.chat.pat" id="cPat" min="5" step="5" disabled={isC} /></label>
      </div>
      <p class="hint">How long people hold before giving up. Less patience means more abandoned contacts, and slightly better service levels for the people who stay. Erlang A only.</p>
    </section>
    <section class="grp">
      <h3>Volumes are entered per</h3>
      <Seg id="periodSeg" value={v.period} onpick={setPeriod} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} />
      <p class="hint" id="periodHint">{v.periodHint}</p>
    </section>
    <section class="grp">
      <h3>Opening hours</h3>
      <div class="days" id="openDays">{#each DOW as d, i}<button data-i={i} aria-pressed={v.openDays[i]} onclick={() => toggleOpenDay(i)}>{d}</button>{/each}</div>
      <label class="inline"><Check k="h24" id="h24" /> Open 24 hours</label>
      <div class="inline" id="hoursRow" style:display={v.h24 ? 'none' : 'flex'}>From <Sel k="openFrom" id="openFrom" style="width:90px">{#each hours as h}<option value={String(h)}>{String(h).padStart(2, '0')}:00</option>{/each}</Sel> to <Sel k="openTo" id="openTo" style="width:90px">{#each hours as h}<option value={String(h)}>{String(h).padStart(2, '0')}:00</option>{/each}</Sel></div>
    </section>
    <section class="grp">
      <h3>Day-of-week pattern</h3>
      <BarEditor id="dowBars" xid="dowX" small vals={v.S.dayW} labels={DOW} closed={(i) => !S.openDays[i]} readout={(i, f) => `${DOW[i]} ${pct(f, 0)} of week`} onChange={() => changed('dow', true)} onDone={() => changed('dow')} />
    </section>
    {#each [['voice', 'Calls', 'v', 'Calls', 'Average handle time (seconds)', 1, 30, 10, false], ['chat', 'Chats', 'c', 'Chats', 'Handle time per chat (min)', 60, 1, 0.5, true], ['email', 'Emails', 'e', 'Emails', 'Handle time per email (min)', 60, 1, 0.5, true], ['ticket', 'Self-service tickets', 't', 'Tickets', 'Handle time per ticket (min)', 60, 1, 0.5, true]] as [c, title, p, noun, ahtLabel, scale, ahtMin, ahtStep, conc]}
      <section class="grp">
        <h3><span class="sw {c}"></span>{title} <label class="tog inline"><Check k="ch.{c}.on" id="{p}On" /> On</label></h3>
        <div class="fields">
          <label class="field"><span>{noun} per <em class="per">{v.per}</em></span><Num k="ch.{c}.vol" id="{p}Vol" min="0" step="50" /></label>
          <label class="field"><span>{ahtLabel}</span><Num k="ch.{c}.aht" id="{p}Aht" scale={scale} min={ahtMin} step={ahtStep} /></label>
          {#if conc}<label class="field"><span>{noun} at once per agent</span><Num k="ch.{c}.conc" id="{p}Conc" min="1" max="6" step="1" /></label>{/if}
        </div>
        {#if c === 'ticket'}<p class="hint">Raised through a self-service portal. Worked like email: from a backlog, in the time agents aren't on calls or chats.</p>{/if}
      </section>
    {/each}
    <section class="grp">
      <h3>Intraday pattern</h3>
      <div class="inline" style="justify-content:space-between">
        <Seg id="curveSeg" value={curveCh} onpick={(c) => (curveCh = c)} options={[['voice', 'Calls'], ['chat', 'Chats'], ['email', 'Emails'], ['ticket', 'Tickets']]} />
        <select id="presetSel" style="width:auto" bind:this={presetEl} onchange={() => { const p = presetEl.value; if (!p) return; applyPreset(curveCh, p); presetEl.value = ''; }}>
          <option value="">Apply a preset…</option><option value="office">Office-hours peak</option><option value="evening">Long evening tail</option><option value="email">Inbox (morning heavy)</option><option value="ticket">Portal (long day)</option><option value="flat">Flat</option>
        </select>
      </div>
        <BarEditor id="curveBars" xid="curveX" vals={v.S.ch[curveCh].curve} labels={curveLabels} closed={(i) => !isOpenIv(i * 2)} readout={(i, f) => `${String(i).padStart(2, '0')}:00 · ${pct(f, 1)} of the day`} onChange={() => changed('curve', true)} onDone={() => changed('curve')} />
      <p class="hint">Drag across the bars to reshape the day. Striped hours are closed.</p>
    </section>
    <section class="grp">
      <h3>Languages</h3>
      <div id="langRows" style="display:grid;gap:8px">
        {#each v.langs as l, i}
          {#if i === 0}
            <div class="lang-row"><span></span><input type="text" value={l.name} aria-label="Main language name" onchange={(e) => setLang(0, 'name', e.currentTarget.value)}><span class="pct">{v.rest}% (rest)</span></div>
          {:else}
            <div class="lang-row"><input type="checkbox" checked={l.on} aria-label="Use {l.name}" onchange={(e) => setLang(i, 'on', e.currentTarget.checked)}><input type="text" value={l.name} aria-label="Language name" disabled={!l.on} onchange={(e) => setLang(i, 'name', e.currentTarget.value)}><span class="pct"><input type="number" min="0" max="90" value={l.share} style="width:60px" disabled={!l.on} aria-label="{l.name} share" oninput={(e) => setLang(i, 'share', e.currentTarget.value)}>%</span></div>
          {/if}
        {/each}
      </div>
      <p class="hint">Every agent can take English contacts. Other languages need their own agents.</p>
    </section>
    <section class="grp">
      <h3>Forecast accuracy</h3>
      <div class="inline">Daily volumes land within ±<Num k="fcErr" id="fcErr" min="0" max="30" step="1" />% of forecast (one standard deviation)</div>
    </section>
  </div>
</aside>
