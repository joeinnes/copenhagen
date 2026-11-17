<script>
  import { onMount } from 'svelte';
  import { ui, start, closeAll, setDrawer, closeShifts, closeSplash } from '../engine.svelte.js';
  import TopBar from './TopBar.svelte';
  import SizingStrip from './SizingStrip.svelte';
  import Wallboard from './Wallboard.svelte';
  import Floor from './Floor.svelte';
  import SizeReport from './SizeReport.svelte';
  import RiskReport from './RiskReport.svelte';
  import Splash from './Splash.svelte';
  import ShiftSchedule from './ShiftSchedule.svelte';
  import DemandDrawer from './DemandDrawer.svelte';
  import SetupDrawer from './SetupDrawer.svelte';
  onMount(() => start());
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') closeAll(); }} />

<div class="app">
  <TopBar />
  <SizingStrip />
  <Wallboard />
  <Floor />
  <SizeReport />
  <RiskReport />
</div>

<div class="scrim" id="scrim" role="presentation" hidden={!(ui.drawer || ui.shifts || ui.splash)} onclick={() => { setDrawer(null); closeShifts(); closeSplash(); }}></div>
<div class="toast" class:bad={ui.toast?.bad} id="toast" role="status" hidden={!ui.toast}>{ui.toast?.msg}</div>
<Splash />
<ShiftSchedule />
<DemandDrawer />
<SetupDrawer />
