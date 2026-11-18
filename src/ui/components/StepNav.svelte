<script>
  // The flow through the tool. Sticky; the step in view is highlighted. Buttons scroll rather than link, because the
  // page link's # part carries shared scenarios.
  import { onMount } from 'svelte';
  import { ui, S, REC, CONF, sizing, clientShare } from '../engine.svelte.js';
  const STEPS = [['live', 'Live floor'], ['brief', 'Brief'], ['headcount', 'Headcount'], ['risk', 'SLA risk'], ['rota', 'Rota']];
  let cur = $state('live');
  const fte = $derived.by(() => { ui.rev; ui.sizing; const n = sizing(REC).tot.contract, sh = clientShare();
    return CONF.busy ? '…' : S.shared && sh < 0.999 ? (n * sh).toFixed(1) : String(n); });
  function go(id) { document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
  onMount(() => {
    const seen = new Map();
    const io = new IntersectionObserver((es) => {
      for (const e of es) seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null);
      const vis = STEPS.map(([id]) => id).filter((id) => seen.get(id) != null);
      if (vis.length) cur = vis[0];
    }, { rootMargin: '-80px 0px -55% 0px' });
    for (const [id] of STEPS) { const el = document.getElementById(id); if (el) io.observe(el); }
    return () => io.disconnect();
  });
</script>

<nav class="steps" aria-label="Steps">
  <ol>
    {#each STEPS as [id, label], i}
      <li><button aria-current={cur === id ? 'step' : undefined} onclick={() => go(id)}><i>{i + 1}</i>{label}{#if id === 'headcount'}<span class="steps-fte">{fte} FTE</span>{/if}</button></li>
    {/each}
  </ol>
</nav>
