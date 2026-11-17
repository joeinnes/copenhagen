<script>
  // The welcome splash: getting started, and how the numbers work.
  import { ui, closeSplash } from '../engine.svelte.js';
  import Seg from './Seg.svelte';
  let tab = $state('start'), goEl;
  $effect(() => { if (ui.splash) setTimeout(() => goEl?.focus(), 30); });
</script>

<div class="modal splash" id="splash" role="dialog" aria-modal="true" aria-labelledby="spTitle" hidden={!ui.splash}>
  <div class="modal-head">
    <div><p class="eyebrow">Contact centre sizing</p><h2 id="spTitle">How many agents does this service desk need?</h2></div>
    <button class="x" id="spClose" aria-label="Close" onclick={closeSplash}>×</button>
  </div>
  <Seg id="spTabs" role="tablist" value={tab} onpick={(v) => (tab = v)} options={[['start', 'Getting started'], ['how', 'How the numbers work']]} />
  <div id="spStart" hidden={tab !== 'start'}>
  <p class="sp-lede">Enter the volumes you expect and the service you're promising. Copenhagen works out the headcount, builds the rota, and plays out a day on the floor so you can see whether it holds.</p>
  <ol class="sp-steps">
    <li><b>Set demand and targets</b><span>Open <em>Demand &amp; targets</em>. Volumes, handle times and the daily curve are the givens. Service targets are what you're selling: tighten them and the headcount goes up.</span></li>
    <li><b>Read the answer</b><span>The strip under the top bar shows the FTE you need, after rest days (5 days in 7), annual leave and sickness. Further down, you'll find the split by team and the FTE for other call targets.</span></li>
    <li><b>Check the rota</b><span><em>Shift schedule</em> shows the optimal start times for each day. <em>Will this rota hit target?</em> gives the odds of meeting each target today, this week or this month.</span></li>
    <li><b>Stress-test it</b><span>Play the day on the floor and watch the wallboard. Click an agent to send them home sick, press <em>Major incident</em> to double call volume, then replan in <em>Desk set-up</em>.</span></li>
    <li><b>Save and share</b><span>Name the scenario at the top, then Save it in this browser, or choose <em>Share link</em> to put the whole set-up in the page link.</span></li>
  </ol>
  </div>
  <div id="spHow" hidden={tab !== 'how'}>
    <ol class="sp-steps">
      <li><b>Queue maths every half hour</b><span>The day is split into 48 half-hour intervals. In each one, Erlang A turns forecast arrivals, handle time and agents into a service level, an abandon rate and an average wait, with callers hanging up when their patience runs out. Switch to Erlang C for the classic no-abandon version. Each chat agent counts as several servers, one per concurrent chat. Emails and self-service tickets are first-in, first-out backlogs worked from spare agent time, shared between them in proportion to their workload, each with its own ‘resolved within X hours’ target.</span></li>
      <li><b>Finding the headcount</b><span>For the busiest weekday and the busiest weekend day, the tool searches for the smallest roster whose optimised shifts hit every target across the day: service level, abandon limit, chats and emails. That allows for shrinkage on shift and for the agents you can expect to be away.</span></li>
      <li><b>Building the shifts</b><span>Every shift is the full 9 hours (4 on, a 1-hour lunch, 4 on), starting on any half hour and free to run past midnight. An optimiser places each shift where it closes the biggest gap between agents needed and agents on seat, then keeps moving shifts until nothing improves.</span></li>
      <li><b>From roster to FTE</b><span>Each agent works 5 days in 7, so FTE is agent-days ÷ 5. Annual leave and sick days are spread over 260 working days, so each rostered agent has that chance of being away on any day. Rosters are sized up to cover it.</span></li>
      <li><b>Minimum staffing</b><span>Unless the desk is shared, every team keeps at least 2 agents on seat whenever it's open, with lunches staggered, and never has fewer than 3 people. Everyone is entitled to leave and may fall sick, so cover has to survive one person being away while lunches are still taken. That makes 3 the floor even for a 9-hour desk, and about 7 a day for a 24-hour team. It applies to the recommendation, the shift plans and the confidence search, whatever the volume.</span></li>
      <li><b>Part-time and shared agents</b><span>Part-time shifts (4 to 6 hours, no lunch) can make up a set share of each day's roster; the optimiser places them where they buy the most cover per paid hour, and each counts as hours ÷ 8 of an FTE. For a shared service, other clients' calls, chats, emails and tickets join the same queues as ghost contacts at (clients − 1) × your rate on each channel; the pool is sized as a whole, and this client's share is 1 ÷ clients of it.</span></li>
      <li><b>Sizing to a confidence level</b><span>You set the contract length and the risk you'll accept: at most N missed months over the contract (by default 1 in 84, for a 5 + 1 + 1 contract), an X% chance of no missed month at all, or a plain share of months. That becomes the share of months that must hit every target (1 miss in 84 means 98.8%), and the tool scales the roster up or down, rerunning the 500-month simulation each time, until it finds the smallest roster that gets there. Rosters move in whole agents, so the achieved share can land above the aim; the strip shows the figure actually reached.</span></li>
      <li><b>500 simulated weeks</b><span>The likelihood figures come from simulating the period 500 times: 500 days, weeks or months. In every run, each day's volume is drawn around the forecast using your forecast accuracy, with a shared element so a busy week tends to stay busy, and a random number of agents is off. The rota stays as planned. The likelihood is the share of runs that hit each target, and the monthly histogram shows the spread.</span></li>
      <li><b>The live floor</b><span>The floor and wallboard play out today's modelled numbers. Each morning, leave and sickness are rolled at random. What each agent is doing is drawn from the modelled occupancy, and queue lengths are drawn around the modelled averages.</span></li>
    </ol>
    <p class="hint">Why Copenhagen? In 1917, A.K. Erlang worked out the queueing maths this tool runs on while working for the Copenhagen Telephone Company, sizing its exchanges.</p>
    <p class="hint">Assumptions: arrivals are random within each half hour, handle times and patience follow the usual exponential curves, routing is by language only, and spare language agents can help with English but not the other way round.</p>
  </div>
  <div class="sp-foot">
    <label class="inline"><input type="checkbox" id="spHide" bind:checked={ui.spHide}> Don't show this again</label>
    <button class="btn primary" id="spGo" bind:this={goEl} onclick={closeSplash}>Get started</button>
  </div>
</div>
