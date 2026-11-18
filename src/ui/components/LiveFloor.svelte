<script>
  // Step 5: play a day on the floor. The clock, speed, incident and absence controls all live here, next to what they change.
  import { ui, DOW, live, simMin, incidentOn, setDow, setClock, toggleIncident, callSick, replanNow, resetToday, backToWork } from '../engine.svelte.js';
  import { AG } from '../floor.js';
  import { hhmm } from '../format.js';
  import Section from './Section.svelte';
  import Seg from './Seg.svelte';
  import Wallboard from './Wallboard.svelte';
  import Floor from './Floor.svelte';

  let scrubEl;
  const clock = $derived.by(() => { ui.tick; ui.live; const on = incidentOn(), ending = on && live.incident.to < 48;
    return { min: simMin(), dow: live.dow, on, ending, inc: ending ? `Ends at ${hhmm(live.incident.to * 30)}` : on ? 'End incident' : 'Major incident',
      incTitle: ending ? 'Winding down at the end of this half hour. Click to keep the incident running.' : on ? 'Stop the incident at the end of the current half hour' : 'Double call volume from now' }; });
  $effect(() => { const m = clock.min; if (scrubEl && document.activeElement !== scrubEl) scrubEl.value = String(Math.floor(m)); });
  const today = $derived.by(() => { ui.live; ui.rev;
    return { sick: [...live.sick].map((k) => ({ k, name: AG.get(k)?.p.name })).filter((x) => x.name), leave: live.leave.size, replanned: live.replanned }; });
</script>

<Section id="live" n="5" name="Live floor" title="Does it hold up on the day?" sub="Play a day through. Send people home sick or start a major incident, then replan and watch the wallboard.">
  <div class="toolbar" role="group" aria-label="Simulation">
    <div class="tb-group">
      <div class="clock">
        <select id="daySel" aria-label="Day of week" value={String(clock.dow)} onchange={(e) => setDow(+e.currentTarget.value)}>
          {#each DOW as d, i}<option value={String(i)}>{d}</option>{/each}
        </select>
        <output id="clockOut">{hhmm(clock.min)}</output>
        <input type="range" id="scrub" bind:this={scrubEl} min="0" max="1439" step="1" aria-label="Time of day" oninput={() => setClock(+scrubEl.value)}>
      </div>
      <button class="btn" id="playBtn" aria-label={ui.playing ? 'Pause' : 'Play'} onclick={() => (ui.playing = !ui.playing)}>{ui.playing ? 'Pause' : 'Play'}</button>
      <Seg id="speedSeg" label="Simulation speed" value={ui.speed} onpick={(v) => (ui.speed = +v)} options={[[1, '1×'], [60, '60×'], [240, '240×'], [900, '900×']]} />
    </div>
    <div class="tb-group">
      <button class="btn" id="sickBtn" onclick={callSick}>Call someone in sick</button>
      <button class="btn" id="replanBtn" title="Move shifts that haven't started yet to cover the gap" onclick={replanNow}>Replan shifts</button>
      <button class="btn danger" class:ending={clock.ending} id="incBtn" aria-pressed={clock.on} title={clock.incTitle} onclick={toggleIncident}>{clock.inc}</button>
      <button class="btn ghost" id="resetDay" title="Start the day again with fresh leave and sickness" onclick={resetToday}>Restart day</button>
    </div>
  </div>
  <div class="sick-list" id="sickList">
    {#each today.sick as s (s.k)}<span class="chip">{s.name} off sick<button onclick={() => backToWork(s.k)}>Undo</button></span>
    {:else}<span class="hint">Nobody is off sick.</span>{/each}
    <span class="hint">{today.leave} on annual leave today.{today.replanned ? " Shifts that hadn't started were replanned around today's absence." : ''} Click an agent to send them home.</span>
  </div>
  <Wallboard />
  <Floor />
</Section>
