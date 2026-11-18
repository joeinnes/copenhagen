<script>
  // One step of the flow: a panel with the step number, a name, the question it answers, and optional controls on the right.
  let { id, n, name, title, sub = '', actions = undefined, children } = $props();
</script>
<section class="report sec" {id} aria-labelledby="{id}-title">
  <div class="sec-head">
    <div class="sec-title">
      <span class="eyebrow">Step {n} · {name}</span>
      <h2 id="{id}-title">{title}</h2>
      {#if sub}<p class="hint">{sub}</p>{/if}
    </div>
    {#if actions}<div class="sec-actions">{@render actions()}</div>{/if}
  </div>
  {@render children()}
</section>
