<script>
  // The isometric floor. Drawing and pointer handling live in floor.js; this places the canvas, zoom buttons, legend and popover.
  import { onMount } from 'svelte';
  import { ui, sendHome, backToWork } from '../engine.svelte.js';
  import { attachFloor, zoomIn, zoomOut, resetCam, closePop } from '../floor.js';
  let cv, floorEl;
  onMount(() => attachFloor(cv, floorEl));
  const legend = [['#2a78d6', 'On a call'], ['#eb6834', 'Chatting'], ['#1baf7a', 'Emails'], ['#6250d6', 'Tickets'], ['#3ccf6e', 'Ready'], ['#f2b53a', 'Break or lunch'], ['#e34948', 'Off sick']];
</script>

<section>
  <div class="floor" id="floor" bind:this={floorEl}>
    <canvas id="cv" bind:this={cv} aria-label="Contact centre floor. Click an agent to see their shift or send them home sick."></canvas>
    <div class="zoom" role="group" aria-label="Zoom">
      <button class="btn" id="zIn" aria-label="Zoom in" onclick={zoomIn}>+</button><button class="btn" id="zOut" aria-label="Zoom out" onclick={zoomOut}>−</button><button class="btn" id="zFit" disabled={!ui.zoomed} onclick={resetCam}>Fit</button>
    </div>
    {#if ui.pop}
      {@const p = ui.pop}
      <div class="pop" id="pop" style:left="{p.left}px" style:top="{p.top}px">
        <h4>{p.name}</h4><div class="meta">{p.team} team · {p.desc}<br>{p.shift}</div>
        <div class="row">
          {#if p.st === 'sick'}<button class="btn" id="pBack" onclick={() => { backToWork(p.key); closePop(); }}>Back to work</button>
          {:else if p.st !== 'rest' && p.st !== 'leave'}<button class="btn" id="pSick" onclick={() => { sendHome(p.key); closePop(); }}>Send home sick</button>{/if}
          <button class="btn ghost" id="pClose" onclick={closePop}>Close</button>
        </div>
      </div>
    {/if}
  </div>
  <div class="legend">
    {#each legend as [c, t]}<span><i style:background={c}></i>{t}</span>{/each}
    <span style="color:var(--muted)">Click an agent to see their shift. Zoom with +, pinch, Ctrl + scroll or double-click; drag to pan.</span>
  </div>
</section>
