<script>
  // A number or range input bound to a scenario setting (k is a dotted path into S, e.g. "ch.voice.vol").
  // Typing writes through setField, which clamps and ignores blanks; the box is refreshed from S only when not focused.
  import { ui, getP, setField } from '../engine.svelte.js';
  let { k, type = 'number', scale = 1, min, max, step, ...rest } = $props();
  let el;
  $effect(() => {
    ui.inputs; ui.rev;
    const v = getP(k);
    if (el && document.activeElement !== el) el.value = typeof v === 'number' ? String(+(v / scale).toFixed(2)) : v;
  });
</script>
<input bind:this={el} {type} {min} {max} {step} data-k={k} {...rest} oninput={() => setField(k, el.value, { type, scale, min, max })}>
