<script>
  // A segmented control: equal-width buttons, one pressed.
  let { id, options, value, onpick, label = undefined, role = 'group', disabledFn = () => false } = $props();
</script>
<div class="seg" {id} {role} aria-label={label}>
  {#each options as [v, text] (v)}<button data-v={v} aria-pressed={String(v) === String(value)} disabled={disabledFn(v)} onclick={() => onpick(v)}>{text}</button>{/each}
</div>
