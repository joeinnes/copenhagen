<script>
  // The shift schedule: optimal start times for a day, cover against the requirement, and a CSV copy.
  import { ui, S, DOW, PLAN, ROTA_PLAIN, live, getTeams, teamReq, coverage, shS, shPT, shKind, shMins, shSegs, shLabel, shDesc, ptLen } from '../engine.svelte.js';
  import { pct, hhmm } from '../format.js';
  import { shiftGantt, shiftCover } from '../charts.js';
  import { isNightStart } from '../../model';
  import Seg from './Seg.svelte';
  import Section from './Section.svelte';

  let day = $state(live.dow), team = $state('all'), copyTxt = $state('Copy as CSV');

  const v = $derived.by(() => {
    ui.rev;
    const teams = getTeams(), tm = team !== 'all' && !teams.find((t) => t.id === team) ? 'all' : team;
    const sel = teams.filter((t) => tm === 'all' || t.id === tm), g = new Map();
    for (const t of sel) for (const st of PLAN[day]?.[t.id] || []) { if (!g.has(st)) g.set(st, { s: st, n: 0, by: {} }); const o = g.get(st); o.n++; o.by[t.label] = (o.by[t.label] || 0) + 1; }
    const groups = [...g.values()].sort((a, b) => shS(a.s) - shS(b.s) || a.s - b.s), tot = groups.reduce((a, x) => a + x.n, 0);
    const req = new Float64Array(48), on = new Float64Array(48);
    for (const t of sel) { const q = teamReq(t, day), c = coverage(PLAN[day]?.[t.id] || []).on; for (let i = 0; i < 48; i++) { req[i] += q[i]; on[i] += c[i]; } }
    const reqH = req.reduce((a, b) => a + b, 0) / 2, onH = on.reduce((a, b) => a + b, 0) / 2, under = req.reduce((a, r, i) => a + Math.max(0, r - on[i]), 0) / 2;
    const starts = groups.map((x) => shS(x.s) * 30);
    const prefNote = S.shiftPrefs === false ? 'Start times are placed purely on cover.'
      : ROTA_PLAIN ? 'Start times are placed purely on cover: sociable start times would have needed more agents to hit the contract risk aim.'
      : 'Night starts (23:00–05:30) are avoided and 08:00–10:00, 13:00–15:00 and 21:00–22:30 preferred, wherever the same headcount still hits every target.';
    return { teams, sel, groups, tot, openDays: S.openDays.slice(), shrink: S.shrink, prefNote, night: groups.filter((x) => isNightStart(x.s)).reduce((a, x) => a + x.n, 0),
      sub: `The optimal start times for ${DOW[day]}'s forecast with ${tot} agents on shift. ${S.weLong && day >= 5 ? `Full-time agents work ${S.weLongHours || 12}-hour (L) shifts today, with breaks covered by shrinkage` : 'Full-time shifts are 4 hours on, a 1-hour lunch, then 4 hours on'}${S.ptOn ? `; part-time (PT) shifts are ${ptLen() / 2} hours with no lunch` : ''}.`,
      range: groups.length ? hhmm(Math.min(...starts)) + ' – ' + hhmm(Math.max(...starts)) : '–', coverPct: reqH ? pct(onH / reqH, 0) : '–', under: under.toFixed(1), coverLow: reqH > 0 && onH < reqH,
      gantt: shiftGantt({ groups, multiTeam: sel.length > 1, shS, shKind, shSegs, shLabel, shDesc }), cover: shiftCover(req, on) };
  });

  async function copy() {
    const rows = [['Day', 'Team', 'Type', 'Start', 'End', 'Lunch start', 'Lunch end', 'Agents']];
    for (const t of v.sel) {
      const m = new Map(); for (const st of PLAN[day]?.[t.id] || []) m.set(st, (m.get(st) || 0) + 1);
      for (const [st, n] of [...m].sort((a, b) => a[0] - b[0])) { const s0 = shS(st) * 30, k = shKind(st); rows.push([DOW[day], t.label, ['Full-time', 'Part-time', `${shMins(st) / 60}-hour`][k], hhmm(s0), hhmm(s0 + shMins(st)), k ? '' : hhmm(s0 + 240), k ? '' : hhmm(s0 + 300), n]); }
    }
    try { await navigator.clipboard.writeText(rows.map((r) => r.join(',')).join('\n')); copyTxt = 'Copied'; } catch (e) { copyTxt = 'Copy failed'; }
    setTimeout(() => (copyTxt = 'Copy as CSV'), 1600);
  }
</script>

<Section id="rota" n="5" name="Rota" title="When does everyone work?" sub="The optimised shift pattern for each day, and how well it covers the requirement.">
  <div id="shifts" class="rota">
    <div class="inline" style="justify-content:space-between;gap:10px">
      <Seg id="shDay" label="Day" value={day} onpick={(x) => (day = +x)} options={DOW.map((n, i) => [i, n])} disabledFn={(i) => !v.openDays[i]} />
      <div class="inline">
        <select id="shTeam" aria-label="Team" style="width:auto" value={team} onchange={(e) => (team = e.currentTarget.value)}>
          <option value="all">All teams</option>{#each v.teams as t}<option value={t.id}>{t.label}</option>{/each}
        </select>
        <button class="btn" id="shCopy" onclick={copy}>{copyTxt}</button>
      </div>
    </div>
    <p class="hint" id="shSub">{v.sub} {v.prefNote}</p>
    <div class="facts" id="shFacts">
      <div class="fact"><b>{v.groups.length}</b><span>distinct start times</span></div>
      <div class="fact"><b>{v.tot}</b><span>shifts</span></div>
      <div class="fact"><b>{v.range}</b><span>first and last start</span></div>
      <div class="fact"><b>{v.night}</b><span>night starts (23:00–05:30)</span></div>
      <div class="fact"><b>{v.coverPct}</b><span>of the half-hourly requirement covered</span></div>
      <div class="fact"><b>{v.under}h</b><span>agent-hours below the requirement</span></div>
    </div>
    <div class="chart" id="shGantt">
      <h3>Shifts by start time</h3><p class="sub"><span style="color:var(--accent)">■</span> On shift, darker where more agents start together &nbsp; <span style="color:var(--muted)">■</span> Lunch. Hover a row for the team split. {v.groups.length > 14 ? `${v.groups.length} start times; scroll for more.` : ''}</p>
      <div class="gantt-scroll">{@html v.gantt}</div>
    </div>
    <div class="chart" id="shCov">
      <h3>Cover against requirement</h3>
      <p class="hint">The requirement is enough agents to hit the target in every half hour on its own. Targets are measured across the whole day, so a rota can dip below it at the peaks and make it up in quieter half hours: that's usually cheaper, and the SLA risk step shows whether it still holds.</p><p class="sub"><span style="color:var(--accent)">■</span> Agents on seat &nbsp; <span style="font-family:var(--f-mono)">- -</span> Needed for target, after {v.shrink}% shrinkage &nbsp; <span style="color:var(--bad)">■</span> Shortfall</p>
      <div style="overflow-x:auto">{@html v.cover}</div>
    </div>
  </div>
</Section>
