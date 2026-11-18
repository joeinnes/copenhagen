<script>
  import { onMount } from 'svelte';
  import { ui, start, closeAll, setDrawer, closeSplash } from '../engine.svelte.js';
  import TopBar from './TopBar.svelte';
  import StepNav from './StepNav.svelte';
  import Brief from './Brief.svelte';
  import SizeReport from './SizeReport.svelte';
  import RiskReport from './RiskReport.svelte';
  import ShiftSchedule from './ShiftSchedule.svelte';
  import LiveFloor from './LiveFloor.svelte';
  import Splash from './Splash.svelte';
  import DemandDrawer from './DemandDrawer.svelte';
  import TargetsDrawer from './TargetsDrawer.svelte';
  import SetupDrawer from './SetupDrawer.svelte';
  onMount(() => start());
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') closeAll(); }} />

<div class="app">
  <TopBar />
  <StepNav />
  <Brief />
  <SizeReport />
  <RiskReport />
  <ShiftSchedule />
  <LiveFloor />
</div>

<div class="scrim" id="scrim" role="presentation" hidden={!(ui.drawer || ui.splash)} onclick={() => { setDrawer(null); closeSplash(); }}></div>
<div class="toast" class:bad={ui.toast?.bad} id="toast" role="status" hidden={!ui.toast}>{ui.toast?.msg}</div>
<Splash />
<DemandDrawer />
<TargetsDrawer />
<SetupDrawer />
