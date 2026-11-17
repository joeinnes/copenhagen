<script>
  // A checkbox bound to a boolean scenario setting.
  import { ui, getP, setField } from '../engine.svelte.js';
  let { k, ...rest } = $props();
  let el;
  $effect(() => { ui.inputs; ui.rev; if (el) el.checked = !!getP(k); });
</script>
<input bind:this={el} type="checkbox" data-k={k} {...rest} onchange={() => setField(k, el.checked, { type: 'checkbox' })}>
