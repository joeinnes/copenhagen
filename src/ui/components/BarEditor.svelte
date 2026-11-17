<script>
  // Drag across the bars to reshape a profile (day-of-week weights or the intraday curve). Edits the array in place.
  import { ui } from '../engine.svelte.js';
  import { clamp } from '../../model';
  let { id, xid, vals, labels, closed, readout, onChange, onDone, small = false } = $props();
  let box, heights = $state([]), ro = $state(''), drag = false, mx = 1;
  const closedArr = $derived.by(() => { ui.inputs; ui.rev; return vals.map((_, i) => closed(i)); });
  function paint() { mx = Math.max(...vals) * 1.08 || 1; heights = vals.map((v) => v / mx * 100); }
  $effect(() => { ui.inputs; ui.rev; vals; paint(); });
  function at(e) {
    const rc = box.getBoundingClientRect(), i = clamp(Math.floor((e.clientX - rc.left - 6) / ((rc.width - 12) / vals.length)), 0, vals.length - 1);
    return { i, v: clamp((rc.bottom - e.clientY) / (rc.height - 8), 0, 1) * mx };
  }
  function move(e) {
    const { i, v } = at(e);
    if (drag) { vals[i] = Math.max(0.05, v); heights = vals.map((x) => x / mx * 100); onChange(); }
    const sum = vals.reduce((a, b) => a + b, 0); ro = readout(i, vals[i] / sum);
  }
  function down(e) { drag = true; box.setPointerCapture(e.pointerId); paint(); move(e); }
  function up() { drag = false; paint(); onDone && onDone(); }
</script>
<div class="bars" class:small {id} bind:this={box} role="application" aria-label="Drag to reshape"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onpointerleave={() => { if (!drag) ro = ''; }}>
  {#each vals as _, i}<div class="b" class:closed={closedArr[i]} data-i={i}><i style:height="{heights[i]}%"></i></div>{/each}
  <div class="bars-readout">{ro}</div>
</div>
<div class="bars-x" id={xid}>{#each labels as l}<span>{l}</span>{/each}</div>
