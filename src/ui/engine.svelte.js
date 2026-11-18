// Copenhagen engine: the scenario, the recalculation pipeline, the live day and its clock, month to date and saved scenarios.
// There is no markup here. Components read from this module and re-render when the counters in `ui` move:
//   ui.inputs  the scenario was edited (form values, hints)
//   ui.rev     the model was recalculated (sizing, rota, set-up, shift schedule)
//   ui.live    today's floor changed (absence, replanning, incident, day)
//   ui.sizing  the confidence search or the call-target grid finished
//   ui.mc      a simulation result arrived (report, ticker)
//   ui.tick    the clock moved (wallboard, clock), about twice a second
//   ui.scen    the saved-scenario list or the save state changed
// The scenario itself (S) is a plain object, not reactive state: the model reads it in hot loops.
import * as M from '../model';
import { sim } from './sim';
import * as F from './floor.js';
import { pct, hhmm } from './format.js';

export const { CH, CHN, DEFER, DOW, PRESET, DEFAULT, clamp, mulberry, hashStr, gauss } = M;

export const ui = $state({
  inputs: 0, rev: 0, live: 0, sizing: 0, mc: 0, tick: 0, scen: 0,
  drawer: null, splash: false, spHide: false, scPanel: false,
  toast: null, pop: null, zoomed: false,
  playing: true, speed: 240, repPeriod: 'week',
});

/* ============ scenario and storage ============ */
export let S;
// One-off move from the old Erlang Floor keys: copy anything saved there to the Copenhagen keys, then remove the old ones.
try{for(const k of ['v2','scenarios','splash']){const o='erlangfloor.'+k,n='copenhagen.'+k,v=localStorage.getItem(o);
  if(v!=null){if(localStorage.getItem(n)==null)localStorage.setItem(n,v);localStorage.removeItem(o)}}}catch(e){}
try{const j=JSON.parse(localStorage.getItem('copenhagen.v2')||'null');S=j&&j.ch&&j.langs?Object.assign(structuredClone(DEFAULT),j):structuredClone(DEFAULT)}catch(e){S=structuredClone(DEFAULT)}
// repair older saved settings: missing channels, and opening hours stored as null while the hours bug was live
function sanitise(){if(S.ch&&!S.ch.ticket)S.ch.ticket=structuredClone(DEFAULT.ch.ticket);if(!Number.isFinite(S.openFrom))S.openFrom=8;if(!Number.isFinite(S.openTo))S.openTo=20;
  S.openFrom=clamp(Math.round(S.openFrom),0,23);S.openTo=clamp(Math.round(S.openTo),0,24);if(S.openTo%24===S.openFrom)S.openTo=(S.openFrom+1)%24||24}
if(S.minOn==null){S.minOn=true;S.minOnSeat=2;S.minPeople=3}
if(S.confMode==null){S.confOn=true;S.confMode='misses';S.contractMonths=84;S.missesAllowed=1;S.cleanChance=90;S.conf=99;S.confPeriod='month'}
sanitise();
function save(){try{localStorage.setItem('copenhagen.v2',JSON.stringify(S))}catch(e){}}
export function getP(p){return p.split('.').reduce((o,k)=>o[k],S)}
export function setP(p,v){const ks=p.split('.'),l=ks.pop();ks.reduce((o,k)=>o[k],S)[l]=v}

/* ============ model, bound to the current scenario ============ */
// A context holds the scenario plus memo tables that are only valid for it. Any change to S goes through recompute(),
// which starts a fresh context; if S itself is replaced (a loaded scenario), C() notices and starts one too.
let mctx=null;
const C=()=>{if(!mctx||mctx.S!==S)mctx=M.makeCtx(S);return mctx};
const freshCtx=()=>{mctx=M.makeCtx(S);return mctx};
export const openDayCount=()=>M.openDayCount(C()), weeklyVol=c=>M.weeklyVol(C(),c);
export const isOpenIv=i=>M.isOpenIv(C(),i), activeLangs=()=>M.activeLangs(C()), langFrac=k=>M.langFrac(C(),k);
export const getTeams=()=>M.getTeams(C()), ghostK=()=>M.ghostK(C()), clientShare=()=>M.clientShare(C());
export const attend=()=>M.attend(C()), minSeat=()=>M.minSeat(C()), teamReq=(t,d)=>M.teamReq(C(),t,d);
export const weekendOpen=()=>M.weekendOpen(C()), weekdayOpen=()=>M.weekdayOpen(C());
export const shS=M.shS, shPT=M.shPT, shLong=M.shLong, shKind=M.shKind, ptLen=()=>M.ptLen(C()), shMins=x=>M.shMins(C(),x);
const allowedStarts=M.allowedStarts, optimise=(req,types,fixed,al)=>M.optimise(C(),req,types,fixed,al);
export const coverage=(starts,skip)=>M.coverage(C(),starts,skip);
const evalDay=(d,mult,sched,boost,att)=>M.evalDay(C(),d,mult,sched,boost,att), summarise=res=>M.summarise(C(),res);
export const rosterSize=(id,d)=>M.rosterSize(C(),S.hc,id,d), deskCount=id=>M.deskCount(C(),S.hc,id);
export const sizing=hc=>M.sizing(C(),hc);
export const confTarget=()=>M.confTarget(S), confPeriodNow=()=>M.confPeriodNow(S);
export function shSegs(x){const s0=shS(x)*30;return shKind(x)?[[s0,s0+shMins(x),0]]:[[s0,s0+240,0],[s0+240,s0+300,1],[s0+300,s0+540,0]]}
/** How a shift reads in a tooltip or popover: "Shift 08:00–17:00, lunch 12:00–13:00", "Part-time shift 10:00–14:00", "12-hour shift 08:00–20:00". */
export function shDesc(x){const s0=shS(x)*30;return shPT(x)?`Part-time shift ${shLabel(x)}`:shLong(x)?`${shMins(x)/60}-hour shift ${shLabel(x)}`:`Shift ${hhmm(s0)}–${hhmm(s0+540)}, lunch ${hhmm(s0+240)}–${hhmm(s0+300)}`}
export function shLabel(x){const s0=shS(x)*30;return `${hhmm(s0)}–${hhmm(s0+shMins(x))}`}

/* ============ plans & live day ============ */
export let PLAN={}, liveRes=null, liveSum=null;
export const live={dow:0,starts:{},sick:new Set(),leave:new Set(),incident:null,replanned:false};
function computePlans(){PLAN=M.computePlans(C(),S.hc)}
export const plannedSched=d=>M.plannedSched(C(),PLAN,d);
function sickIdx(id){const s=new Set();for(const k of [...live.sick,...live.leave]){const [tid,ix]=k.split('#');if(tid===id)s.add(+ix)}return s}
export function liveSched(){const o={};for(const t of getTeams())o[t.id]=coverage(live.starts[t.id]||[],sickIdx(t.id)).on;return o}
function resetLive(keepSick){
  live.starts={};for(const t of getTeams())live.starts[t.id]=PLAN[live.dow][t.id].slice();
  if(!keepSick){live.sick=new Set();live.leave=new Set();live.incident=null;
    const ps=M.pSick(C()),pl=M.pLeave(C());
    for(const t of getTeams())for(let k=0;k<live.starts[t.id].length;k++){const r=Math.random();if(r<ps)live.sick.add(t.id+'#'+k);else if(r<ps+pl)live.leave.add(t.id+'#'+k)}}
  else{const ok=k=>{const [tid,ix]=k.split('#');return live.starts[tid]&&+ix<live.starts[tid].length};live.sick=new Set([...live.sick].filter(ok));live.leave=new Set([...(live.leave||[])].filter(ok))}
  live.replanned=false;
}
function boostArr(){if(!live.incident)return null;const b=new Float64Array(48).fill(1);for(let i=live.incident.from;i<live.incident.to;i++)b[i]=2;return b}
export const incidentOn=()=>{if(!live.incident)return false;const i=Math.floor(simMin()/30);return i>=live.incident.from&&i<live.incident.to};
function evalLive(){liveRes=evalDay(live.dow,1,liveSched(),boostArr());liveSum=summarise(liveRes)}
function replan(){
  const now=Math.floor(simMin()/30),al=allowedStarts().filter(s=>s>now);
  for(const t of getTeams()){
    const st=live.starts[t.id],sk=sickIdx(t.id),fixed=[],mov=[];
    st.forEach((x,k)=>{if(sk.has(k))return;(shS(x)<=now?fixed:mov).push(k)});
    if(!mov.length||!al.length)continue;
    const fc=coverage(fixed.map(k=>st[k])).on;
    const ns=optimise(teamReq(t,live.dow),mov.map(k=>shKind(st[k])),fc,al),byType=[0,1,2].map(kd=>ns.filter(x=>shKind(x)===kd));
    mov.forEach(k=>{st[k]=byType[shKind(st[k])].shift()});
  }
  live.replanned=true;
}
/** Today's simulation runs here (it depends on the live floor); week and month go to the worker. */
function liveKey(){return live.dow+'|'+[...live.sick].sort()+'|'+[...live.leave].sort()+'|'+JSON.stringify(live.starts)+'|'+JSON.stringify(live.incident)}
function runDayMC(){return M.runMC(C(),{period:'day',hc:S.hc,plan:PLAN,live:{dow:live.dow,sched:liveSched(),boost:boostArr(),key:liveKey()}})}

/* ============ sizing ============ */
export let REC={}, REC0={}, MINH={}, REC_WARN=new Set(), TRADE=null;
let tradeGen=0;
function startTrade(){
  const g=++tradeGen,v=S.ch.voice;TRADE=null;
  if(!v.on){TRADE={none:true};ui.sizing++;return}
  sim({type:'trade',S}).then(r=>{if(g!==tradeGen)return;TRADE=r;ui.sizing++});
}
export const CONF={busy:false,p:null,f:1,gen:0};
export function confAimTxt(){const N=Math.round(+S.contractMonths||84),k=+S.missesAllowed||0;
  if(S.confMode==='misses')return `at most ${k} missed month${k===1?'':'s'} in ${N}`;
  if(S.confMode==='clean')return `${S.cleanChance}% chance of no missed month in ${N}`;
  return `${S.conf}% of ${S.confPeriod==='week'?'weeks':'months'}`}
export const pctAim=()=>(confTarget()*100).toFixed(confTarget()>0.999?2:1)+'%';
function startConf(){
  const g=++CONF.gen;CONF.busy=true;CONF.p=null;ui.sizing++;
  sim({type:'conf',S,rec0:REC0,minh:MINH}).then(r=>{
    if(g!==CONF.gen)return;
    CONF.busy=false;CONF.p=r.p;CONF.f=r.f;REC=r.hc;
    for(const t of getTeams())if(S.autoSize||!S.hc[t.id])S.hc[t.id]={...(REC[t.id]||{wd:0,we:0})};
    // the roster changed, so restart the month, but keep the clock where the user left it
    computePlans();{const t=simSec;doSimReset();simSec=t}evalLive();buildMTD();F.buildLayout();ui.sizing++;ui.rev++;ui.live++;scheduleMC();save()});
}

/* ============ sim clock ============ */
export let simSec=9*3600;
export const simMin=()=>simSec/60;
if(typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches)ui.playing=false;
function advance(sec){simSec+=sec;if(simSec>=86400){simSec-=86400;if(liveSum)MTD.hist[MTD.date]=tally(47,1);EV=new Map();MTD.date++;if(MTD.date>MONTH_DAYS){MTD.date=1;MTD.hist={}}live.dow=(live.dow+1)%7;resetLive(false);evalLive();buildMTD();F.teleportAll();ui.live++;scheduleMC(true)}}
/** Jump the clock (from the time slider). */
export function setClock(min){simSec=min*60;F.teleportAll();wbState.next=0;ui.tick++}

/* ============ wallboard data ============ */
export const MONTH_DAYS=30;
const wbState={waiting:0,longest:0,cw:0,next:0};
function poisson(l){if(l<=0)return 0;if(l>30)return Math.max(0,Math.round(l+Math.sqrt(l)*gauss()));let L=Math.exp(-l),k=0,p=1;do{k++;p*=Math.random()}while(p>L);return k-1}
/* ---- month to date: a 30-day month; earlier days come from the model, days played through are kept as they happened ---- */
export const MTD={date:1,hist:{},prior:null};
// A change to the model (volumes, targets, staffing...) restarts the simulated month: day 1, start of the day, fresh absences.
let simReset=false;
function doSimReset(){EV=new Map();MTD.date=1;MTD.hist={};simSec=(S.h24?0:Math.max(0,((S.openFrom||0)+23)%24))*3600;resetLive(false);wbState.next=0}
function zeroTot(){const o={};for(const c of CH)o[c]={off:0,sla:0,ab:0};return o}
function buildMTD(){const tot=zeroTot();
  for(let d=1;d<MTD.date;d++){const x=MTD.hist[d]||zeroTot();for(const c of CH)for(const k of ['off','sla','ab'])tot[c][k]+=x[c][k]}
  MTD.prior=tot}
/* The live board counts whole contacts. When the clock first reaches a half hour, its arrivals are drawn from the model
   (a Poisson count around the expected number) and each contact gets an arrival time and a definite outcome.
   Once drawn, a half hour never changes, so a later sick call or incident only affects what's still to come. */
let EV=new Map();
function poissonR(l){if(l<=0)return 0;if(l>40)return Math.max(0,Math.round(l+Math.sqrt(l)*gauss()));const L=Math.exp(-l);let k=0,p=1;do{k++;p*=Math.random()}while(p>L);return k-1}
function drawIv(i){
  const V=liveSum.iv.voice,Ch=liveSum.iv.chat,out={voice:[],chat:[],email:[]};
  const pick=(sl,ab)=>{const u=Math.random();return u<sl?'sl':u<sl+ab?'ab':'late'};
  for(const l of activeLangs()){const x=liveSum.ivLang[l.key];if(!x||!(x.off[i]>0))continue;
    const n=poissonR(x.off[i]),sl=x.sla[i]/x.off[i],ab=V.off[i]>0?Math.min(1-sl,V.ab[i]/V.off[i]):0;
    for(let k=0;k<n;k++)out.voice.push({t:Math.random(),o:pick(sl,ab),L:l.key})}
  if(Ch.off[i]>0){const n=poissonR(Ch.off[i]),sl=Ch.sla[i]/Ch.off[i],ab=Math.min(1-sl,Ch.ab[i]/Ch.off[i]);for(let k=0;k<n;k++)out.chat.push({t:Math.random(),o:pick(sl,ab)})}
  out.ticket=[];
  for(const c of DEFER){const e=liveSum.ch[c],esl=e.off>0?e.sla/e.off:1,arr=liveSum.iv[c];
    if(arr.off[i]>0){const n=poissonR(arr.off[i]);for(let k=0;k<n;k++)out[c].push({t:Math.random(),o:Math.random()<esl?'sl':'late'})}}
  return out;
}
function ivEvents(i){if(!EV.has(i))EV.set(i,drawIv(i));return EV.get(i)}
function tally(i,fr){const t=zeroTot();t.lang={};
  for(let j=0;j<=i;j++){const ev=ivEvents(j),lim=j===i?fr:1;
    for(const c of CH)for(const e of ev[c]){if(e.t>lim)continue;t[c].off++;if(e.o==='sl')t[c].sla++;else if(e.o==='ab')t[c].ab++;
      if(c==='voice'){const L=t.lang[e.L]||(t.lang[e.L]={off:0,sla:0});L.off++;if(e.o==='sl')L.sla++}}}
  return t}
/** Everything the wallboard shows at this moment. `now` is wall-clock seconds, used to refresh the queue every 2s. */
export function wallboardData(now){
  if(!liveSum)return null;
  const m=simMin(),i=Math.floor(m/30)%48,fr=(m%30)/30,V=liveSum.iv.voice,Ch=liveSum.iv.chat;
  if(now>wbState.next||now<wbState.next-10){wbState.next=now+2;wbState.waiting=poisson(V.lq[i]);wbState.cw=poisson(Ch.lq[i]);
    const w=V.off[i]>0?V.w[i]/V.off[i]:0;wbState.longest=wbState.waiting>0?w*(0.6+0.5*Math.log(1+wbState.waiting))*(0.8+Math.random()*0.4):0}
  const td=tally(i,fr),mt=zeroTot();if(MTD.prior)for(const c of CH)for(const k of ['off','sla','ab'])mt[c][k]=MTD.prior[c][k]+td[c][k];
  const cnt={voice:0,chat:0,email:0,ticket:0,idle:0,brk:0,lunch:0,sick:live.sick.size,leave:live.leave.size};
  for(const a of F.AG.values()){const st=F.planState(a,m);if(st==='lunch')cnt.lunch++;else if(st==='work'){if(a.breakUntil>m)cnt.brk++;else if(a.loc==='seated')cnt[a.act]++}}
  const langs=activeLangs().filter(l=>liveSum.ivLang[l.key]).map(l=>{const x=td.lang[l.key],v=x&&x.off?x.sla/x.off:null;return l.name.slice(0,2).toUpperCase()+' '+(v==null?'–':Math.round(v*100))}).join(' · ');
  return {m,i,dow:live.dow,incident:incidentOn()?live.incident:null,waiting:wbState.waiting,longest:wbState.longest,cw:wbState.cw,
    td,mt,cnt,langs,mtdDay:MTD.date,emailBacklog:liveSum.iv.email.backlog[i],ticketBacklog:liveSum.iv.ticket.backlog[i]};
}
export function tickerText(){
  if(!MC.day)return 'LOADING FORECAST…';const d=MC.day,V=S.ch.voice,bits=[];
  bits.push(`${DOW[live.dow].toUpperCase()} FORECAST: ${CH.filter(c=>S.ch[c].on).map(c=>Math.round(d.exp.ch[c].off).toLocaleString('en-GB')+' '+CHN[c].toUpperCase()).join(' · ')}`);
  if(V.on&&d.P.voice!=null)bits.push(`${Math.round(d.P.voice*100)}% CHANCE OF HITTING ${V.slPct}/${V.slSec} TODAY`);
  if(live.sick.size||live.leave.size)bits.push(`${live.sick.size} OFF SICK · ${live.leave.size} ON LEAVE${live.replanned?' · ROTA REPLANNED':''}`);
  const tot=getTeams().reduce((a,t)=>a+rosterSize(t.id,live.dow),0);bits.push(`${tot} AGENTS ON TODAY'S ROTA`);
  if(live.incident)bits.unshift(incidentOn()&&live.incident.to<48?'MAJOR INCIDENT ENDING AT '+hhmm(live.incident.to*30)+': VOLUMES RETURNING TO NORMAL':incidentOn()?'MAJOR INCIDENT IN PROGRESS: CALL VOLUMES DOUBLED. ALL AVAILABLE AGENTS PLEASE STAY ON THE PHONES':'MAJOR INCIDENT RESOLVED AT '+hhmm(live.incident.to*30));
  bits.push('REMEMBER TO SET YOUR STATUS WHEN YOU GO ON BREAK');
  return bits.join('   ★   ');
}
/** The arrays behind today's chart: requirement, live cover and planned cover, summed over teams. */
export function dayCover(){
  const teams=getTeams(),req=new Float64Array(48),sch=new Float64Array(48),pln=new Float64Array(48);
  const lsch=liveSched(),psch=plannedSched(live.dow);
  for(const t of teams){const q=teamReq(t,live.dow);for(let i=0;i<48;i++){req[i]+=q[i];sch[i]+=lsch[t.id][i];pln[i]+=psch[t.id][i]}}
  return {req,sch,pln,V:liveSum.iv.voice,C:liveSum.iv.chat};
}

/* ============ simulation results ============ */
export let MC={};
let mcGen=0,tMC=0;
function requestMC(period){const g=mcGen;
  sim({type:'mc',S,hc:S.hc,period}).then(r=>{if(g!==mcGen)return;MC[period]=r;ui.mc++})}
function scheduleMC(onlyDay){clearTimeout(tMC);if(!onlyDay)mcGen++;MC=onlyDay?{...MC,day:null}:{};ui.mc++;
  tMC=setTimeout(()=>{MC.day=runDayMC();if(ui.repPeriod!=='day'&&!MC[ui.repPeriod])requestMC(ui.repPeriod);ui.mc++},120)}
export function setRepPeriod(v){ui.repPeriod=v;
  if(!MC[v]){if(v==='day')setTimeout(()=>{MC.day=runDayMC();ui.mc++},30);else requestMC(v)}ui.mc++}

/* ============ change pipeline ============ */
let tChange=0,needRec=true,rerollAbsence=false;
/** Call after any edit to S. `what` names the setting; `light` debounces longer (sliders and drags). */
export function changed(what,light){
  if(what==='alDays'||what==='sickDays')rerollAbsence=true;
  if(what!=='name')simReset=true;
  if(what==='hc')S.autoSize=false;else if(!['autoSize','fcErr','name'].includes(what))needRec=true;
  save();ui.scen++;ui.inputs++;clearTimeout(tChange);tChange=setTimeout(()=>recompute(),light?220:60);
}
function recompute(){
  freshCtx();
  if(needRec){const r=M.computeRec(C());REC0=r.rec;MINH=r.minh;REC_WARN=new Set(r.warn);
    REC=S.confOn&&CONF.f?M.scaleRec(C(),REC0,MINH,CONF.f):REC0;needRec=false;startTrade();
    if(S.confOn)startConf();else{CONF.gen++;CONF.busy=false;CONF.p=null;CONF.f=1}}
  for(const t of getTeams())if(S.autoSize||!S.hc[t.id]||typeof S.hc[t.id]!=='object')S.hc[t.id]={...(REC[t.id]||{wd:0,we:0})};
  EV=new Map();computePlans();if(simReset){simReset=false;doSimReset()}else resetLive(!rerollAbsence);rerollAbsence=false;
  evalLive();buildMTD();F.buildLayout();ui.rev++;ui.live++;ui.inputs++;scheduleMC();save();
}
function afterLiveChange(){evalLive();ui.live++;scheduleMC(true)}

/* ============ actions ============ */
export function callSick(){
  const m=simMin(),pool=[...F.AG.values()].filter(a=>!live.sick.has(a.key)&&!['off','rest','leave'].includes(F.planState(a,m)));
  const pool2=pool.length?pool:[...F.AG.values()].filter(a=>!['rest','leave','sick'].includes(F.planState(a,m)));
  if(!pool2.length)return;const a=pool2[Math.floor(Math.random()*pool2.length)];live.sick.add(a.key);afterLiveChange()}
export function sendHome(key){live.sick.add(key);afterLiveChange()}
export function backToWork(key){live.sick.delete(key);afterLiveChange()}
export function replanNow(){replan();afterLiveChange()}
export function resetToday(){resetLive(false);afterLiveChange();F.teleportAll()}
export function setDow(d){live.dow=d;EV=new Map();resetLive(false);evalLive();buildMTD();F.teleportAll();ui.live++;scheduleMC()}
export function toggleIncident(){const i=Math.floor(simMin()/30);
  if(incidentOn()){if(live.incident.to<48)live.incident.to=48;else live.incident.to=i+1}else live.incident={from:i,to:48};
  afterLiveChange();wbState.next=0;ui.tick++}
export function useRecommended(){S.autoSize=true;changed('autoSize')}
export function stepHc(id,f,d){const h=S.hc[id];h[f]=Math.max(0,Math.round(h[f]||0)+d);changed('hc')}
export function setHc(id,f,v){S.hc[id][f]=clamp(Math.round(+v||0),0,400);changed('hc')}
export function toggleOpenDay(i){S.openDays[i]=!S.openDays[i];changed('open')}
export function setPeriod(v){const f={day:openDayCount(),week:1,month:7/30.44},from=f[S.period],to=f[v];
  for(const c of CH)S.ch[c].vol=Math.round(S.ch[c].vol*from/to);S.period=v;changed('period')}
export function setConfMode(v){S.confMode=v;S.confOn=true;changed('confMode')}
export function setModel(v){if(S.model===v)return;S.model=v;changed('model')}
export function setMode(v){if(S.mode===v)return;S.mode=v;S.hc={};changed('mode')}
export function applyPreset(ch,name){S.ch[ch].curve=PRESET[name].slice();changed('curve')}
export function setLang(i,f,raw){const l=S.langs[i];l[f]=f==='on'?!!raw:f==='share'?clamp(+raw||0,0,90):String(raw).trim()||l.name;changed('lang')}
/** Write a form value to the scenario, with the same rules for every field: clamp to min/max, ignore blanks and NaN. */
export function setField(k,raw,{type,scale=1,str=false,min,max}={}){
  let v;
  if(type==='checkbox')v=!!raw;else if(str)v=raw;else{v=+raw*scale;if(!isFinite(v)||raw==='')return;
    // only number and range inputs carry min/max; a select has neither, and +undefined would turn the value into NaN
    if(min!=null&&min!=='')v=Math.max(+min*scale,v);if(max!=null&&max!=='')v=Math.min(+max*scale,v);if(!isFinite(v))return}
  if(/^ch\.(chat|email|ticket)\.conc$/.test(k))v=Math.round(v);
  setP(k,v);
  if(!S.h24&&S.openTo%24===S.openFrom%24){S.openTo=(S.openFrom+1)%24||24}
  changed(k,type==='range');
}

/* ============ drawers, modals and the toast ============ */
export function setDrawer(id){ui.drawer=id}
export function openSplash(){ui.splash=true}
export function closeSplash(){if(!ui.splash)return;ui.splash=false;
  if(ui.spHide){try{localStorage.setItem('copenhagen.splash','off')}catch(e){}}}
export function closeAll(){setDrawer(null);F.closePop();closeSplash();ui.scPanel=false}
let flashT=0;
export function flash(msg,bad){ui.toast={msg,bad:!!bad};clearTimeout(flashT);flashT=setTimeout(()=>ui.toast=null,3200)}

/* ============ saved scenarios ============ */
// Scenarios travel in the link: #cfg-<z|r><base64 of deflated JSON>, with + and / escaped as -a and -b
// (the artifact link only carries letters, digits and hyphens in its fragment).
export const SC={list:[],curId:null,saved:null,confirmDel:null,lastHash:''};
const snapshotS=()=>JSON.stringify(S);
// What counts as an edit: headcount is left out while it's matched to the recommendation, since the model fills it in.
const editKey=()=>JSON.stringify(S.autoSize?{...S,hc:null}:S);
export function scDirty(){return SC.saved!==editKey()}
function localList(){try{return JSON.parse(localStorage.getItem('copenhagen.scenarios')||'[]')}catch(e){return []}}
function localWrite(l){try{localStorage.setItem('copenhagen.scenarios',JSON.stringify(l));return true}catch(e){return false}}
async function encodeConfig(obj){
  const raw=new TextEncoder().encode(JSON.stringify(obj));let data=raw,z='r';
  if(window.CompressionStream){try{data=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());z='z'}catch(e){data=raw;z='r'}}
  let bin='';for(let i=0;i<data.length;i++)bin+=String.fromCharCode(data[i]);
  return 'cfg-'+z+btoa(bin).replace(/=+$/,'').replace(/\+/g,'-a').replace(/\//g,'-b');
}
async function decodeConfig(hash){
  const m=/^#?cfg-([zr])([A-Za-z0-9-]+)$/.exec(hash||'');if(!m)return null;
  let b=m[2].replace(/-a/g,'+').replace(/-b/g,'/');while(b.length%4)b+='=';
  const bin=atob(b),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  let out=bytes;if(m[1]==='z')out=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  return JSON.parse(new TextDecoder().decode(out));
}
function applyConfig(cfg,name){
  S=Object.assign(structuredClone(DEFAULT),cfg);if(name)S.name=name;sanitise();
  needRec=true;ui.inputs++;recompute();SC.saved=editKey();ui.scen++;
}
export async function openFromHash(){
  const h=location.hash;if(!h||h===SC.lastHash||!/^#cfg-/.test(h))return;
  SC.lastHash=h;
  try{const cfg=await decodeConfig(h);if(!cfg||!cfg.ch)throw 0;SC.curId=null;applyConfig(cfg);flash(`Opened shared scenario “${S.name||'Untitled'}”`)}
  catch(e){flash('That link doesn’t contain a scenario this page can read.',true)}
}
export async function shareLink(){
  const h=await encodeConfig(S);SC.lastHash='#'+h;location.hash=h;
  const href=location.href;
  if(/^https:\/\/claude\.ai\//.test(href)){try{await navigator.clipboard.writeText(href);flash('Link copied. Anyone with access to this page can open the scenario.');return}catch(e){}}
  flash('Link updated. Copy it from the address bar, or use Share then Copy link.');
}
export function setName(v){S.name=v;save();ui.scen++}
export function saveScenario(asNew){
  const name=(S.name||'').trim()||'Untitled scenario';S.name=name;
  const id=(!asNew&&SC.curId)||('s'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
  const l=localList().filter(x=>x.id!==id);
  l.unshift({id,name,config:snapshotS(),fte:sizing(REC).tot.contract,model:S.model,savedAt:Date.now()});
  if(!localWrite(l)){flash('This browser won’t let the page save. Use Share link instead.',true);return}
  SC.list=l;SC.curId=id;SC.saved=editKey();save();flash(`Saved “${name}” in this browser`);ui.scen++;
}
export function loadScenario(id){
  const sc=SC.list.find(x=>x.id===id);if(!sc)return;
  let cfg;try{cfg=JSON.parse(sc.config)}catch(e){flash('That scenario couldn’t be read.',true);return}
  SC.curId=id;applyConfig(cfg,sc.name);ui.scPanel=false;flash(`Opened “${sc.name}”`);
}
export function askDelete(id){SC.confirmDel=id;ui.scen++}
export function deleteScenario(id){
  SC.list=localList().filter(x=>x.id!==id);localWrite(SC.list);
  if(SC.curId===id){SC.curId=null;SC.saved=null}
  SC.confirmDel=null;ui.scen++;
}
export function toggleScPanel(){ui.scPanel=!ui.scPanel;SC.confirmDel=null;SC.list=localList();ui.scen++}
/** Every setting back to its default. Saved scenarios are untouched. */
export function resetAll(){
  SC.curId=null;SC.lastHash='';if(location.hash)location.hash='';
  F.resetCam();setDrawer(null);ui.scPanel=false;
  simReset=true;applyConfig(structuredClone(DEFAULT));
  flash('Everything is back to the default settings. Saved scenarios are still under Saved.');
}

/* ============ boot ============ */
{const r=M.computeRec(C());REC0=r.rec;MINH=r.minh;REC_WARN=new Set(r.warn);REC=REC0;needRec=false;}
for(const t of getTeams())if(S.autoSize||!S.hc[t.id]||typeof S.hc[t.id]!=='object')S.hc[t.id]={...(REC[t.id]||{wd:0,we:0})};
computePlans();resetLive(false);evalLive();buildMTD();F.buildLayout();
{let off=false;try{off=localStorage.getItem('copenhagen.splash')==='off'}catch(e){}ui.splash=!off}

/** Start the background work and the animation loop. Returns a function that stops the loop. */
export function start(){
  scheduleMC();startTrade();if(S.confOn)startConf();
  SC.list=localList();ui.scen++;openFromHash();
  const onHash=()=>openFromHash();window.addEventListener('hashchange',onHash);
  let raf=0,last=performance.now(),lastDraw=0,lastWb=0;
  const frame=now=>{
    const dt=Math.min(0.1,(now-last)/1000);last=now;
    if(ui.playing)advance(dt*ui.speed);
    F.updateAgents(dt);if(now-lastDraw>=31){lastDraw=now;F.drawScene(now/1000)}
    if(now-lastWb>400){lastWb=now;ui.tick++}
    raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);
  return ()=>{cancelAnimationFrame(raf);window.removeEventListener('hashchange',onHash)};
}
