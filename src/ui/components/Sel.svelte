<script>
  // A select bound to a scenario setting. `str` keeps the value as text; otherwise it is stored as a number.
  import { ui, getP, setField } from '../engine.svelte.js';
  let { k, str = false, children, ...rest } = $props();
  let el;
  $effect(() => { ui.inputs; ui.rev; if (el && document.activeElement !== el) el.value = String(getP(k)); });
</script>
<select bind:this={el} data-k={k} {...rest} onchange={() => setField(k, el.value, { str })}>{@render children()}</select>
