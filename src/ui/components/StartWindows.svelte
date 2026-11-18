<script>
  // Half-hour strip for blocking shift starts. Click or drag to block; start a drag on a blocked cell to unblock.
  import { ui, S, changed } from '../engine.svelte.js';
  import { startPenalty } from '../../model';
  import { hhmm } from '../format.js';

  let blocked = $state(new Set()), paint = null, strip;
  $effect(() => { ui.inputs; ui.rev; blocked = new Set(S.noStart || []); });
  const prefs = $derived.by(() => { ui.inputs; return S.shiftPrefs !== false; });

  function commit() { S.noStart = [...blocked].sort((a, b) => a - b); changed('noStart'); }
  function cellAt(e) {
    const rc = strip.getBoundingClientRect();
    return Math.max(0, Math.min(47, Math.floor(((e.clientX - rc.left) / rc.width) * 48)));
  }
  function set(i) { const b = new Set(blocked); paint ? b.add(i) : b.delete(i); blocked = b; }
  function down(e) { const i = cellAt(e); paint = !blocked.has(i); strip.setPointerCapture(e.pointerId); set(i); }
  function move(e) { if (paint != null) set(cellAt(e)); }
  function up() { if (paint == null) return; paint = null; commit(); }
  function key(e, i) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); const b = new Set(blocked); b.has(i) ? b.delete(i) : b.add(i); blocked = b; commit(); }
  }
  function preset(cells) { blocked = new Set(cells); commit(); }
  const NIGHT = [46, 47, ...Array(12).keys()];

  /** "23:00–06:00, 12:00–13:00", wrapping past midnight. */
  const summary = $derived.by(() => {
    const on = (i) => blocked.has(((i % 48) + 48) % 48);
    if (!blocked.size) return 'Shifts may start at any time.';
    if (blocked.size === 48) return 'Every half hour is blocked, so the rule is ignored.';
    let start = 0; while (on(start)) start++;
    const runs = [];
    for (let k = 0; k < 48; k++) { const i = (start + k) % 48; if (on(i) && !on(i - 1)) { let j = i; while (on(j + 1)) j++; runs.push(`${hhmm(i * 30)}–${hhmm((j + 1) * 30)}`); } }
    return `No shift starts ${runs.join(', ')}.`;
  });
</script>

<div class="starts">
  <div class="starts-strip" bind:this={strip} role="group" aria-label="Half hours when shifts may start"
    onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
    {#each Array(48) as _, i}
      <button type="button" class="sc" class:blocked={blocked.has(i)} class:ideal={prefs && startPenalty(i) === 0} class:night={prefs && startPenalty(i) === 3}
        aria-pressed={blocked.has(i)} aria-label="{hhmm(i * 30)} {blocked.has(i) ? 'blocked' : 'allowed'}" title="{hhmm(i * 30)}: {blocked.has(i) ? 'no starts' : 'starts allowed'}"
        onkeydown={(e) => key(e, i)} onclick={(e) => e.preventDefault()}></button>
    {/each}
  </div>
  <div class="bars-x">{#each Array(8) as _, k}<span>{String(k * 3).padStart(2, '0')}</span>{/each}</div>
  <p class="hint"><span id="noStartSummary">{summary}</span>{#if prefs} Green cells are the preferred start times.{/if}</p>
  <div class="inline">
    <button class="btn" type="button" id="blockNights" onclick={() => preset(NIGHT)}>Block 23:00–06:00</button>
    <button class="btn ghost" type="button" id="clearBlocks" disabled={!blocked.size} onclick={() => preset([])}>Allow all</button>
  </div>
</div>
