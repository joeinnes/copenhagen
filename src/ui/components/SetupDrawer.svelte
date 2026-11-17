<script>
  // Desk set-up: team model, headcount per team, contracts, shrinkage, today's absence, minimum staffing, part-time and sharing.
  import { ui, S, REC, MINH, live, getTeams, weekdayOpen, weekendOpen, minSeat, sizing, attend, setDrawer, setMode, stepHc, setHc, useRecommended,
    callSick, replanNow, resetToday, backToWork } from '../engine.svelte.js';
  import { AG } from '../floor.js';
  import { pct } from '../format.js';
  import Num from './Num.svelte';
  import Check from './Check.svelte';
  import Sel from './Sel.svelte';
  import Seg from './Seg.svelte';

  let closeEl;
  $effect(() => { if (ui.drawer === 'setup') setTimeout(() => closeEl?.focus(), 50); });

  const v = $derived.by(() => {
    ui.rev; ui.inputs; ui.sizing;
    const wdO = weekdayOpen(), weO = weekendOpen();
    const teams = getTeams().map((t) => {
      const rec = REC[t.id] || { wd: 0, we: 0 }, h = S.hc[t.id] || { wd: 0, we: 0 }, m = MINH[t.id] || { wd: 0, we: 0 };
      const lowW = wdO && m.wd && h.wd < m.wd, lowE = weO && m.we && h.we < m.we;
      return { t, rec, h: { wd: Math.round(h.wd || 0), we: Math.round(h.we || 0) }, short: (wdO && h.wd < rec.wd) || (weO && h.we < rec.we),
        recTxt: [wdO ? rec.wd + ' on weekdays' : '', weO ? rec.we + ' at weekends' : ''].filter(Boolean).join(', '),
        low: lowW || lowE ? [lowW ? m.wd + ' on weekdays' : '', lowE ? m.we + ' at weekends' : ''].filter(Boolean).join(' and ') : null };
    });
    return { mode: S.mode, shrink: S.shrink, wdO, weO, teams, minSeat: minSeat(), fte: `${sizing(S.hc).tot.contract} FTE · ${pct(1 - attend(), 1)} of rostered days lost to leave and sickness` };
  });
  const today = $derived.by(() => { ui.live; ui.rev;
    return { sick: [...live.sick].map((k) => ({ k, name: AG.get(k)?.p.name })).filter((x) => x.name), leave: live.leave.size, replanned: live.replanned }; });
</script>

{#snippet stepper(t, f, lab, val)}
  <label>{lab}<span class="stepper">
    <button aria-label="Fewer" onclick={() => stepHc(t.id, f, -1)}>−</button>
    <input type="number" min="0" max="400" value={val} aria-label="{t.label} {lab}" onchange={(e) => setHc(t.id, f, e.currentTarget.value)}>
    <button aria-label="More" onclick={() => stepHc(t.id, f, 1)}>+</button>
  </span></label>
{/snippet}

<aside class="drawer right" class:open={ui.drawer === 'setup'} id="setup" aria-label="Desk set-up" aria-hidden={ui.drawer !== 'setup'}>
  <header><div><h2>Desk set-up</h2><p>Headcount, contracts and today's absence</p></div><button class="x" bind:this={closeEl} aria-label="Close" onclick={() => setDrawer(null)}>×</button></header>
  <div class="drawer-body">
    <section class="grp">
      <h3>Team model</h3>
      <Seg id="modeSeg" value={v.mode} onpick={setMode} options={[['blended', 'Blended'], ['dedicated', 'Dedicated']]} />
      <p class="hint" id="modeHint">{v.mode === 'blended' ? 'Each language team takes every channel. Calls get priority, then chats; emails and tickets fill the gaps.' : 'Each language has a separate team per channel. No sharing between channels.'}</p>
    </section>
    <section class="grp">
      <h3>Agents rostered per day</h3>
      <label class="inline"><Check k="autoSize" id="autoSize" /> Match the recommendation automatically</label>
      <div id="teamList" style="display:grid;gap:8px">
        {#each v.teams as x (x.t.id)}
          <div class="team" style="grid-template-columns:1fr"><b>{x.t.label}</b>
            <div class="stp-row">{#if v.wdO}{@render stepper(x.t, 'wd', 'Mon–Fri', x.h.wd)}{/if}{#if v.weO}{@render stepper(x.t, 'we', 'Sat–Sun', x.h.we)}{/if}</div>
            <div class="meta">{x.t.sub} · recommended {x.recTxt}{#if x.short} <span style="color:var(--bad)">(short)</span>{/if}
              {#if x.low}<br><span style="color:var(--bad)">Below minimum cover: needs at least {x.low} to keep {v.minSeat} on seat through leave and lunches.</span>{/if}</div>
          </div>
        {/each}
      </div>
      <div class="inline"><button class="btn" id="useRec" onclick={useRecommended}>Use recommended for all</button><span class="busy" id="fte">{v.fte}</span></div>
    </section>
    <section class="grp">
      <h3>Contracts</h3>
      <p class="hint">Each agent works 5 days in 7. On any day, each rostered agent may be on leave or off sick, at random, in line with these yearly averages.</p>
      <div class="fields">
        <label class="field"><span>Annual leave (days a year)</span><Num k="alDays" id="alDays" min="0" max="60" step="1" /></label>
        <label class="field"><span>Sick leave (days a year)</span><Num k="sickDays" id="sickDays" min="0" max="40" step="1" /></label>
      </div>
    </section>
    <section class="grp">
      <h3>Shrinkage</h3>
      <div class="inline" style="justify-content:space-between"><span>Time off the phones on shift</span><b id="shrinkOut" style="font-family:var(--f-mono)">{v.shrink}%</b></div>
      <Num k="shrink" id="shrink" type="range" min="0" max="45" step="1" />
      <p class="hint">Breaks, toilet trips, coaching and admin. Lunch is already in the shift pattern.</p>
      <label class="inline"><Check k="spare" id="spare" /> Spare language agents help with English</label>
    </section>
    <section class="grp">
      <h3>Today's absence</h3>
      <div class="inline"><button class="btn" id="sickBtn" onclick={callSick}>Call someone in sick</button><button class="btn" id="replanBtn" onclick={replanNow}>Replan remaining shifts</button></div>
      <div class="sick-list" id="sickList">
        {#each today.sick as s (s.k)}<span class="chip">{s.name}<button onclick={() => backToWork(s.k)}>Undo</button></span>
        {:else}<span class="hint">Nobody is off sick today.</span>{/each}
        <span class="hint" style="flex-basis:100%">{today.leave} on annual leave today. Absence is rolled at random each day; Reset today rolls it again.</span>
      </div>
      <p class="hint" id="replanHint">{today.replanned ? "Remaining shifts have been replanned around today's absence." : "Replanning moves shifts that haven't started yet to cover the gap. Agents already on shift stay put."}</p>
      <button class="btn ghost" id="resetDay" style="justify-self:start" onclick={resetToday}>Reset today and reroll absence</button>
    </section>
    <section class="grp">
      <h3>Minimum staffing</h3>
      <label class="inline"><Check k="minOn" id="minOn" /> Keep a minimum staffing level (not applied to shared desks)</label>
      <div class="inline">At least <Num k="minOnSeat" id="minOnSeat" min="1" max="10" step="1" style="width:56px" /> agents on seat whenever the desk is open</div>
      <div class="inline">At least <Num k="minPeople" id="minPeople" min="1" max="20" step="1" style="width:56px" /> people in every team</div>
      <p class="hint">Everyone is entitled to leave and may fall sick, and everyone takes lunch. With 2 on seat and lunches staggered, cover survives one person being away; so even a 9-hour desk needs at least 3 people, and longer hours need more. The headcount never goes below this, whatever the volume.</p>
    </section>
    <section class="grp">
      <h3>Part-time shifts</h3>
      <label class="inline"><Check k="ptOn" id="ptOn" /> Use part-time shifts</label>
      <div class="inline">Part-time shifts last <Sel k="ptHours" id="ptHours" style="width:auto"><option value="4">4 hours</option><option value="5">5 hours</option><option value="6">6 hours</option></Sel> with no lunch</div>
      <div class="inline">Up to <Num k="ptShare" id="ptShare" min="0" max="100" step="5" /> % of agents on shift each day</div>
      <p class="hint">Part-timers fill the peaks without paying for a full day. A 4-hour part-timer counts as half an FTE.</p>
    </section>
    <section class="grp">
      <h3>Shared service</h3>
      <label class="inline"><Check k="shared" id="shared" /> Agents are shared with other clients</label>
      <div class="inline">Clients sharing the agents <Num k="clients" id="clients" min="2" max="10" step="1" /></div>
      <p class="hint">Other clients' calls, chats, emails and tickets join the same queues as ghost contacts, at (clients − 1) × this client's rate on each channel. The bigger pool is more efficient, and the headline shows this client's share of it: 1 ÷ clients.</p>
    </section>
    <section class="grp">
      <h3>Shift pattern</h3>
      <p class="hint">Every full-time shift is the full 9 hours: 4 hours on, a 1-hour lunch, then 4 hours on. Shifts can start on any half hour and may run past midnight into the next day. Each day's rota is optimised against that day's forecast. Opening hours can also run past midnight, for example 18:00 to 06:00.</p>
    </section>
  </div>
</aside>
