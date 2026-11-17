<script>
  import { ui, S, SC, DOW, live, simMin, incidentOn, scDirty, setName, saveScenario, shareLink, toggleScPanel, loadScenario, askDelete, deleteScenario, resetAll,
    setDrawer, openSplash, openShifts, setDow, setClock, toggleIncident } from '../engine.svelte.js';
  import { hhmm } from '../format.js';
  import Seg from './Seg.svelte';

  const model = $derived.by(() => { ui.inputs; ui.rev; return S.model; });

  // scenario bar
  let nameEl, panelEl, openEl;
  const bar = $derived.by(() => { ui.scen; ui.inputs; ui.rev; const dirty = scDirty();
    return { label: SC.curId ? (dirty ? 'Save changes' : 'Saved') : 'Save', disabled: !!SC.curId && !dirty, name: S.name || '' }; });
  $effect(() => { const n = bar.name; if (nameEl && document.activeElement !== nameEl) nameEl.value = n; });
  const list = $derived.by(() => { ui.scen; return { items: SC.list.slice(), cur: SC.curId, confirm: SC.confirmDel }; });
  const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  function docClick(e) { if (ui.scPanel && panelEl && !e.composedPath().includes(panelEl) && !e.composedPath().includes(openEl)) ui.scPanel = false; }

  // Reset asks for a second click within 4 seconds
  let confirming = $state(false), resetT = 0;
  function reset() {
    if (!confirming) { confirming = true; clearTimeout(resetT); resetT = setTimeout(() => (confirming = false), 4000); return; }
    clearTimeout(resetT); confirming = false; resetAll();
  }

  // clock
  let scrubEl;
  const clock = $derived.by(() => { ui.tick; ui.live; const on = incidentOn(), ending = on && live.incident.to < 48;
    return { min: simMin(), dow: live.dow, on, ending, inc: ending ? `Ends at ${hhmm(live.incident.to * 30)}` : on ? 'End incident' : 'Major incident',
      incTitle: ending ? 'Winding down at the end of this half hour. Click to keep the incident running.' : on ? 'Stop the incident at the end of the current half hour' : 'Double call volume from now' }; });
  $effect(() => { const m = clock.min; if (scrubEl && document.activeElement !== scrubEl) scrubEl.value = String(Math.floor(m)); });
</script>

<svelte:document onclick={docClick} />

<header class="topbar">
  <div class="brand">
    <h1>Copenhagen</h1>
    <p>Contact centre simulator · <span id="modelTag">Erlang {model}</span></p>
  </div>
  <div class="scen">
    <input type="text" id="scName" bind:this={nameEl} aria-label="Scenario name" placeholder="Name this scenario" maxlength="80" oninput={() => setName(nameEl.value)}>
    <button class="btn" id="scSave" disabled={bar.disabled} onclick={() => saveScenario(false)}>{bar.label}</button>
    <button class="btn" id="scShare" title="Put this scenario in the page link" onclick={shareLink}>Share link</button>
    <button class="btn" id="scOpen" bind:this={openEl} aria-haspopup="true" onclick={toggleScPanel}>Saved ▾</button>
    <button class="btn ghost" class:danger={confirming} id="scReset" title="Put every setting back to its default" onclick={reset}>{confirming ? 'Confirm reset' : 'Reset'}</button>
    <div class="sc-panel" id="scPanel" bind:this={panelEl} hidden={!ui.scPanel}>
      {#if ui.scPanel}
        <div class="sc-head"><b>Saved scenarios</b><button class="btn" id="scNew" onclick={() => saveScenario(true)}>Save as new</button></div>
        <p class="hint">Saved in this browser. To send one to someone else, open it and choose Share link.</p>
        {#if list.items.length}
          <ul class="sc-list">
            {#each list.items as x (x.id)}
              <li class:cur={x.id === list.cur}>
                <button class="sc-open" onclick={() => loadScenario(x.id)}><b>{x.name}</b><span class="meta">{x.fte} FTE · {x.model === 'C' ? 'Erlang C' : 'Erlang A'} · {when(x.savedAt)}</span></button>
                {#if list.confirm === x.id}<button class="btn danger" onclick={() => deleteScenario(x.id)}>Confirm delete</button>
                {:else}<button class="x" aria-label="Delete" onclick={() => askDelete(x.id)}>×</button>{/if}
              </li>
            {/each}
          </ul>
        {:else}<p class="hint">Nothing saved yet. Name this scenario in the top bar and choose Save.</p>{/if}
      {/if}
    </div>
  </div>
  <div class="controls">
    <button class="btn" id="openDemand" onclick={() => setDrawer('demand')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M1 13l4-5 3 3 6-8"/></svg>Demand &amp; targets</button>
    <button class="btn" id="openSetup" onclick={() => setDrawer('setup')}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="5" r="2.5"/><path d="M1 14c0-2.5 1.8-4 4-4s4 1.5 4 4M8 14c0-2.5 1.3-4 3-4s4 1.5 4 4"/></svg>Desk set-up</button>
    <button class="btn" id="openHelp" aria-label="How to use this tool" title="How to use this tool" onclick={openSplash}>?</button>
    <button class="btn" id="openShifts" onclick={openShifts}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="1.5" y="2.5" width="13" height="12" rx="1.5"/><path d="M1.5 6h13M5 1v3M11 1v3M4 9h4M6 12h6"/></svg>Shift schedule</button>
    <div class="clock">
      <select id="daySel" aria-label="Day of week" value={String(clock.dow)} onchange={(e) => setDow(+e.currentTarget.value)}>
        {#each DOW as d, i}<option value={String(i)}>{d}</option>{/each}
      </select>
      <output id="clockOut">{hhmm(clock.min)}</output>
      <input type="range" id="scrub" bind:this={scrubEl} min="0" max="1439" step="1" aria-label="Time of day" oninput={() => setClock(+scrubEl.value)}>
    </div>
    <button class="btn" id="playBtn" aria-label={ui.playing ? 'Pause' : 'Play'} onclick={() => (ui.playing = !ui.playing)}>{ui.playing ? 'Pause' : 'Play'}</button>
    <button class="btn danger" class:ending={clock.ending} id="incBtn" aria-pressed={clock.on} title={clock.incTitle} onclick={toggleIncident}>{clock.inc}</button>
    <Seg id="speedSeg" label="Simulation speed" value={ui.speed} onpick={(v) => (ui.speed = +v)} options={[[1, '1×'], [60, '60×'], [240, '240×'], [900, '900×']]} />
  </div>
</header>
