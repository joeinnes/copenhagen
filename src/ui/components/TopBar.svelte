<script>
  import { ui, S, SC, scDirty, setName, saveScenario, shareLink, toggleScPanel, loadScenario, askDelete, deleteScenario, resetAll, openSplash } from '../engine.svelte.js';

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

</script>

<svelte:document onclick={docClick} />

<header class="topbar">
  <div class="brand">
    <h1>Copenhagen</h1>
    <p>Contact centre sizing · <span id="modelTag">Erlang {model}</span></p>
  </div>
  <div class="scen">
    <input type="text" id="scName" bind:this={nameEl} aria-label="Scenario name" placeholder="Name this scenario" maxlength="80" oninput={() => setName(nameEl.value)}>
    <button class="btn" id="scSave" disabled={bar.disabled} onclick={() => saveScenario(false)}>{bar.label}</button>
    <button class="btn" id="scShare" title="Put this scenario in the page link" onclick={shareLink}>Share link</button>
    <button class="btn" id="scOpen" bind:this={openEl} aria-haspopup="true" aria-expanded={ui.scPanel} onclick={toggleScPanel}>Scenarios <span aria-hidden="true">▾</span></button>
    <div class="sc-panel" id="scPanel" bind:this={panelEl} hidden={!ui.scPanel}>
      {#if ui.scPanel}
        <div class="sc-head"><b>Saved in this browser</b><button class="btn" id="scNew" onclick={() => saveScenario(true)}>Save as new</button></div>
        {#if list.items.length}
          <ul class="sc-list">
            {#each list.items as x (x.id)}
              <li class:cur={x.id === list.cur}>
                <button class="sc-open" onclick={() => loadScenario(x.id)}><b>{x.name}</b><span class="meta">{x.fte} FTE · {x.model === 'C' ? 'Erlang C' : 'Erlang A'} · {when(x.savedAt)}</span></button>
                {#if list.confirm === x.id}<button class="btn danger" onclick={() => deleteScenario(x.id)}>Confirm delete</button>
                {:else}<button class="x" aria-label="Delete {x.name}" onclick={() => askDelete(x.id)}>×</button>{/if}
              </li>
            {/each}
          </ul>
        {:else}<p class="hint">Nothing saved yet. Name this scenario and choose Save.</p>{/if}
        <p class="hint">To send a scenario to someone else, open it and choose Share link.</p>
        <div class="sc-foot"><button class="btn ghost" class:danger={confirming} id="scReset" onclick={reset}>{confirming ? 'Confirm reset' : 'Reset to defaults'}</button><span class="hint">Puts every setting back. Saved scenarios stay.</span></div>
      {/if}
    </div>
    <button class="btn help" id="openHelp" aria-label="How to use Copenhagen" title="How to use Copenhagen" onclick={openSplash}>?</button>
  </div>
</header>
