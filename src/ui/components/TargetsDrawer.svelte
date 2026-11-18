<script>
  // Service targets: what you're selling (service levels and the abandon limit), how sure you need to be, and how it's measured.
  import { ui, S, confAimTxt, confPeriodNow, pctAim, setDrawer, setConfMode, setModel } from '../engine.svelte.js';
  import Num from './Num.svelte';
  import Check from './Check.svelte';
  import Sel from './Sel.svelte';
  import Seg from './Seg.svelte';

  let closeEl;
  $effect(() => { if (ui.drawer === 'targets') setTimeout(() => closeEl?.focus(), 50); });
  const v = $derived.by(() => {
    ui.inputs; ui.rev;
    return { model: S.model, slBasis: S.slBasis, confMode: S.confMode, confPct: S.confMode === 'pct', confUnit: confPeriodNow() === 'week' ? 'week' : 'month',
      aim: confAimTxt().replace(/^./, (c) => c.toUpperCase()), pctAim: pctAim() };
  });
  const isC = $derived(v.model === 'C');
  const basisHint = { offered: 'The strictest reading. Every caller who gives up counts against you.', short: 'Common in contracts. Callers who hang up almost straight away are treated as not really waiting.', answered: 'Flatters the number. When the queue is overloaded, callers who give up stop counting against you, so understaffing can still look on target. The abandon limit is the only safeguard.' };
</script>

{#snippet chHead(c, label)}<h3><span class="sw {c}"></span>{label}</h3>{/snippet}

<aside class="drawer left" class:open={ui.drawer === 'targets'} id="targets" aria-label="Service targets" aria-hidden={ui.drawer !== 'targets'}>
  <header><div><h2>Service targets</h2><p>What you're selling. Tighter targets need more agents.</p></div><button class="x" bind:this={closeEl} aria-label="Close" onclick={() => setDrawer(null)}>×</button></header>
  <div class="drawer-body">
    <section class="grp">
      {@render chHead('voice', 'Calls')}
      <div class="inline">Answer <Num k="ch.voice.slPct" id="vPct" min="1" max="99" /> % within <Num k="ch.voice.slSec" id="vSec" min="1" max="600" /> s</div>
      <div class="inline">Abandoned calls at most <Num k="abTarget" id="abT" min="0" max="50" step="0.5" disabled={isC} /> %</div>
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

    <section class="grp">
      <h3>Penalty risk over the contract</h3>
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
    <div class="part"><span>How it's measured</span><p>Check these against the contract wording.</p></div>
    <section class="grp">
      <h3>Queue model</h3>
      <Seg id="modelSeg" label="Queue model" value={v.model} onpick={setModel} options={[['A', 'Erlang A'], ['C', 'Erlang C']]} />
      <p class="hint" id="modelHint">{v.model === 'A' ? 'Callers hang up when their patience runs out, which shortens the queue for everyone else. More realistic, and gives an abandon rate.' : 'Assumes nobody ever hangs up. More conservative, so it asks for more agents, and it is what many WFM tools and contracts quote. Patience and abandon settings are ignored.'}</p>
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
  </div>
</aside>
