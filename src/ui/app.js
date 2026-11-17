// Copenhagen: page and floor. The modelling lives in ../model (typed, tested); heavy simulation runs in a worker (./sim).
import * as M from '../model';
import { sim } from './sim';
import '../styles.css';

const { CH, CHN, DEFER, DOW, PRESET, DEFAULT, clamp, lerp, mulberry, hashStr, gauss } = M;

/* ============ helpers ============ */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const pct=(x,d=1)=>isFinite(x)?(x*100).toFixed(d)+'%':'–';
const hhmm=m=>{m=((Math.floor(m)%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')};
const mss=s=>{s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const fmtN=n=>Math.round(n).toLocaleString('en-GB');

/* ============ scenario and storage ============ */
let S;
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

/* ============ model, bound to the current scenario ============ */
// A context holds the scenario plus memo tables that are only valid for it. Any change to S goes through recompute(),
// which starts a fresh context; if S itself is replaced (a loaded scenario), C() notices and starts one too.
let mctx=null;
const C=()=>{if(!mctx||mctx.S!==S)mctx=M.makeCtx(S);return mctx};
const freshCtx=()=>{mctx=M.makeCtx(S);return mctx};
const openDayCount=()=>M.openDayCount(C()), weeklyVol=c=>M.weeklyVol(C(),c), dayVol=(c,d)=>M.dayVol(C(),c,d);
const isOpenIv=i=>M.isOpenIv(C(),i), profile=c=>M.profile(C(),c), activeLangs=()=>M.activeLangs(C()), langFrac=k=>M.langFrac(C(),k);
const getTeams=()=>M.getTeams(C()), ghostK=()=>M.ghostK(C()), clientShare=()=>M.clientShare(C());
const pLeave=()=>M.pLeave(C()), pSick=()=>M.pSick(C()), attend=()=>M.attend(C());
const minSeat=()=>M.minSeat(C()), minPpl=()=>M.minPpl(C()), teamReq=(t,d)=>M.teamReq(C(),t,d), coverOK=(t,d,cov)=>M.coverOK(C(),t,d,cov);
const isWE=M.isWE, weekendOpen=()=>M.weekendOpen(C()), weekdayOpen=()=>M.weekdayOpen(C());
const shS=M.shS, shPT=M.shPT, ptLen=()=>M.ptLen(C()), shMins=x=>M.shMins(C(),x), ptCount=H=>M.ptCount(C(),H);
const allowedStarts=M.allowedStarts, coverage=(starts,skip)=>M.coverage(C(),starts,skip), optimise=(req,types,fixed,al)=>M.optimise(C(),req,types,fixed,al);
const evalDay=(d,mult,sched,boost,att)=>M.evalDay(C(),d,mult,sched,boost,att), summarise=res=>M.summarise(C(),res);
const rosterSize=(id,d)=>M.rosterSize(C(),S.hc,id,d), deskCount=id=>M.deskCount(C(),S.hc,id);
const sizing=hc=>M.sizing(C(),hc);
const confTarget=()=>M.confTarget(S), confPeriodNow=()=>M.confPeriodNow(S);
function shSegs(x){const s0=shS(x)*30;return shPT(x)?[[s0,s0+ptLen()*30,0]]:[[s0,s0+240,0],[s0+240,s0+300,1],[s0+300,s0+540,0]]}
function shLabel(x){const s0=shS(x)*30;return `${hhmm(s0)}–${hhmm(s0+shMins(x))}`}

/* ============ plans & live day ============ */
let PLAN={}, live={dow:0,starts:{},sick:new Set(),leave:new Set()}, liveRes=null, liveSum=null;
function computePlans(){PLAN=M.computePlans(C(),S.hc)}
const plannedSched=d=>M.plannedSched(C(),PLAN,d);
function sickIdx(id){const s=new Set();for(const k of [...live.sick,...live.leave]){const [tid,ix]=k.split('#');if(tid===id)s.add(+ix)}return s}
function liveSched(){const o={};for(const t of getTeams())o[t.id]=coverage(live.starts[t.id]||[],sickIdx(t.id)).on;return o}
function resetLive(keepSick){
  live.starts={};for(const t of getTeams())live.starts[t.id]=PLAN[live.dow][t.id].slice();
  if(!keepSick){live.sick=new Set();live.leave=new Set();live.incident=null;
    const ps=pSick(),pl=pLeave();
    for(const t of getTeams())for(let k=0;k<live.starts[t.id].length;k++){const r=Math.random();if(r<ps)live.sick.add(t.id+'#'+k);else if(r<ps+pl)live.leave.add(t.id+'#'+k)}}
  else{const ok=k=>{const [tid,ix]=k.split('#');return live.starts[tid]&&+ix<live.starts[tid].length};live.sick=new Set([...live.sick].filter(ok));live.leave=new Set([...(live.leave||[])].filter(ok))}
  live.replanned=false;
}
function boostArr(){if(!live.incident)return null;const b=new Float64Array(48).fill(1);for(let i=live.incident.from;i<live.incident.to;i++)b[i]=2;return b}
const incidentOn=()=>{if(!live.incident)return false;const i=Math.floor(simMin()/30);return i>=live.incident.from&&i<live.incident.to};
function evalLive(){liveRes=evalDay(live.dow,1,liveSched(),boostArr());liveSum=summarise(liveRes)}
function replan(){
  const now=Math.floor(simMin()/30),al=allowedStarts().filter(s=>s>now);
  for(const t of getTeams()){
    const st=live.starts[t.id],sk=sickIdx(t.id),fixed=[],mov=[];
    st.forEach((x,k)=>{if(sk.has(k))return;(shS(x)<=now?fixed:mov).push(k)});
    if(!mov.length||!al.length)continue;
    const fc=coverage(fixed.map(k=>st[k])).on;
    const ns=optimise(teamReq(t,live.dow),mov.map(k=>shPT(st[k])?1:0),fc,al),byType=[ns.filter(x=>!shPT(x)),ns.filter(shPT)];
    mov.forEach(k=>{st[k]=byType[shPT(st[k])?1:0].shift()});
  }
  live.replanned=true;
}
/** Today's simulation runs here (it depends on the live floor); week and month go to the worker. */
function liveKey(){return live.dow+'|'+[...live.sick].sort()+'|'+[...live.leave].sort()+'|'+JSON.stringify(live.starts)+'|'+JSON.stringify(live.incident)}
function runMC(period){
  if(period==='day')return M.runMC(C(),{period:'day',hc:S.hc,plan:PLAN,live:{dow:live.dow,sched:liveSched(),boost:boostArr(),key:liveKey()}});
  return M.runMC(C(),{period,hc:S.hc,plan:PLAN});
}

/* ============ sizing panel ============ */
let REC={}, REC0={}, MINH={}, REC_WARN=new Set();
let TRADE=null,tradeGen=0;
function startTrade(){
  const g=++tradeGen,v=S.ch.voice;TRADE=null;
  if(!v.on){TRADE={none:true};renderSizing();return}
  sim({type:'trade',S}).then(r=>{if(g!==tradeGen)return;TRADE=r;renderSizing()});
}

function renderSizing(){
  const need=sizing(REC),have=sizing(S.hc),gap=have.tot.contract-need.tot.contract,E=S.ch;
  const shiftTxt=need.nWD&&need.nWE?`${need.tot.wd} / ${need.tot.we}`:`${need.nWD?need.tot.wd:need.tot.we}`;
  const share=clientShare(),shared=S.shared&&share<0.999,headN=shared?(need.tot.contract*share).toFixed(1):need.tot.contract;
  const confTxt=S.confOn?(CONF.busy?`<div class="fact"><b>…</b><span>finding the roster for ${confAimTxt()}</span></div>`:CONF.p!=null?`<div class="fact"><b>${(CONF.p*100).toFixed(1)}%</b><span>of simulated ${confPeriodNow()==='week'?'weeks':'months'} hit every target (aim ${pctAim()}, ${confAimTxt()})</span></div>`:''):'';
  const sharedTxt=shared?`<div class="fact"><b>${need.tot.contract}</b><span>FTE in the pool shared by ${ghostK()} clients</span></div>`:'';
  $('#sizing').innerHTML=`<div><div class="eyebrow">${shared?'This client\'s share':'Agents needed'}</div><div class="need"><span class="n">${headN}</span><span class="u">FTE</span></div></div>
    <div class="facts">
      <div class="fact"><b>${shiftTxt}</b><span>rostered per day${need.nWD&&need.nWE?', weekdays / weekends':''}</span></div>
      <div class="fact"><b>~${need.nWD?Math.round(need.tot.inWd):Math.round(need.tot.inWe)}${need.nWD&&need.nWE?' / ~'+Math.round(need.tot.inWe):''}</b><span>typically in, after ${pct(1-attend(),1)} leave and sickness</span></div>
      <div class="fact"><b>${fmtN(need.tot.days)}</b><span>agent-days a week, 5 days each${need.tot.ptw+need.tot.pte?`, ${need.tot.ptw}${need.nWE?' / '+need.tot.pte:''} part-time`:''}</span></div>
      ${sharedTxt}${confTxt}
    </div>
    <div class="fact" style="justify-items:end;text-align:right"><b style="color:${gap>=0?'var(--good)':'var(--bad)'}">${have.tot.contract} FTE rostered</b><span>${S.autoSize?'Matched to the recommendation':gap>0?gap+' more than needed':gap===0?'Matches the recommendation':(-gap)+' short of the recommendation'}</span></div>`;
  const tg=[];if(E.voice.on)tg.push(`Calls ${E.voice.slPct}/${E.voice.slSec}s, ≤${S.abTarget}% abandoned`);if(E.chat.on)tg.push(`chats ${E.chat.slPct}/${E.chat.slSec}s`);if(E.email.on)tg.push(`emails ${E.email.slPct}% in ${E.email.slHrs}h`);if(E.ticket.on)tg.push(`tickets ${E.ticket.slPct}% in ${E.ticket.slHrs}h`);
  $('#szBasis').textContent='To hit: '+tg.join(' · ')+(S.confOn?` · ${confAimTxt()}`:'')+(shared?` · ${Math.round(share*100)}% share of a ${ghostK()}-client pool`:'');
  if(REC_WARN.size)$('#sizing').insertAdjacentHTML('beforeend',`<p class="hint" style="grid-column:1/-1;color:var(--bad);margin:0">${[...REC_WARN].join(', ')}: the targets can't be met with 9-hour shifts in these opening hours, however many agents are added. Try a longer opening window, a looser target, or a longer email response time.</p>`);
  const wdH=need.nWD?'<th>Mon–Fri <span style="text-transform:none">(in)</span></th>':'',weH=need.nWE?'<th>Sat–Sun <span style="text-transform:none">(in)</span></th>':'';
  const row=(lab,r,cls='')=>`<tr class="${cls}"><td>${lab}</td>${need.nWD?`<td>${r.wd}${r.ptw?` <span style="color:var(--muted)">(${r.ptw} PT)</span>`:''} <span style="color:var(--muted)">~${Math.round(r.inWd)}</span></td>`:''}${need.nWE?`<td>${r.we}${r.pte?` <span style="color:var(--muted)">(${r.pte} PT)</span>`:''} <span style="color:var(--muted)">~${Math.round(r.inWe)}</span></td>`:''}<td>${fmtN(r.days)}</td><td><b>${r.contract}</b></td></tr>`;
  $('#szTeams').innerHTML=`<h3>Recommended headcount by team</h3><p class="hint" style="margin-bottom:8px">Agents rostered per day, including cover for leave and sickness, then FTE at 5 days in 7${S.ptOn?`, with part-timers counting ${(ptLen()/2/8).toFixed(2).replace(/0$/,'')} FTE`:''}.</p>
    <table><tr><th>Team</th>${wdH}${weH}<th>Agent-days / wk</th><th>FTE needed</th></tr>${need.rows.map(r=>row(r.t.label,r)).join('')}${row('Total',need.tot,'tot')}</table>`;
  let tr;
  if(!E.voice.on)tr='<p class="hint">Turn calls on to compare call targets.</p>';
  else if(!TRADE)tr='<p class="busy">Working out the alternatives…</p>';
  else{const v=E.voice;tr=`<table class="tgrid"><tr><th>Answered</th>${TRADE.secs.map(x=>`<th>in ${x}s</th>`).join('')}</tr>`+TRADE.pcts.map(p=>`<tr><th style="text-align:left">${p}%</th>${TRADE.secs.map(x=>{const raw=TRADE.res[p+'|'+x]*(S.confOn&&CONF.f?CONF.f:1),f=shared?+(raw*share).toFixed(1):Math.round(raw),base=shared?+(need.tot.contract*share).toFixed(1):need.tot.contract,d=+(f-base).toFixed(1);return `<td class="${p===v.slPct&&x===v.slSec?'cur':''}">${f}<span style="color:var(--muted);font-size:11px">${d?` ${d>0?'+':''}${d}`:''}</span></td>`}).join('')}</tr>`).join('')+'</table>'}
  $('#szTrade').innerHTML=`<h3>FTE needed for other call targets</h3><p class="hint" style="margin-bottom:8px">Everything else held the same. The small figure is the difference from your current target.${S.confOn?' Scaled by the same confidence margin, so treat as approximate.':''}${shared?' Shown as this client\'s share of the pool.':''}</p>${tr}`;
  $('#szFoot').textContent=`Sized on the busiest weekday and the busiest weekend day, each with its own optimised rota of 4h on, 1h lunch, 4h on. On-shift numbers allow ${S.shrink}% shrinkage. Each agent takes ${S.alDays} days' annual leave and ${S.sickDays} sick days a year, so on any day each rostered agent has a ${pct(1-attend(),1)} chance of being away; rosters are sized up to cover that, and the ~ figures show who is typically in. FTE is agent-days ÷ 5. Each language team is sized on its own; spare language agents helping with English is a bonus on top.`;
}

/* ============ personas ============ */
const SKIN=['#F7D7BC','#EBBE98','#D39A6E','#B07447','#8A5532','#5E3A22'];
const HAIRC=['#1B1410','#2E1F17','#4A2E1D','#7A4B2A','#B7853F','#E1C27A','#9A9A9A','#A9452E','#1B1410','#2E1F17'];
const SHIRT=['#3E6FB0','#C6503E','#3D8C6E','#7F5AA8','#D8A23A','#2F3A4A','#E7E3DA','#5AA6B8','#B5577B','#6B7F3A','#F1F1F1','#22577A','#E07A5F','#81B29A'];
const HIJAB=['#2E4A62','#7B2D43','#3F6B4E','#C9A27E','#1F1F2B','#8B5FBF'];
const FN=['Amara','Priya','Sofia','Mei','Fatima','Chloe','Aisha','Olivia','Yuki','Zara','Ngozi','Hannah','Lucía','Ana','Leila','Grace','Siobhan','Ama','Ingrid','Noor','Kemi','Rosa','Isla','Thandi','Mariam','Camille','Elif','Sana'];
const MN=['Kwame','Raj','Tom','Diego','Hiroshi','Omar','Liam','Chen','Tunde','Mateo','Ahmed','Jamal','Lukas','Arjun','Kofi','Pierre','Callum','Javier','Darius','Samir','Wei','Tariq','Owen','Emeka','Hugo','Mohammed','Bilal'];
const SN=['Okafor','Patel','Nguyen','García','Kowalski','Smith','Haddad','Kim','Mensah','Rossi','Dubois','Khan','Silva','O’Brien','Tanaka','Adeyemi','Novak','Hughes','Ali','Fernández','Cohen','Murphy','Bianchi','Osei','Larsen','Chowdhury','Moreau','Schmidt','Yilmaz','Begum','Campbell','Achterberg'];
function persona(seed){
  const r=mulberry(hashStr(seed)),pick=a=>a[Math.floor(r()*a.length)];
  const f=r()<0.52, p={f,skin:pick(SKIN),hairC:pick(HAIRC),shirt:pick(SHIRT),glasses:r()<0.25,beard:!f&&r()<0.32};
  p.style=f?pick(['long','bob','bun','curly','afro','hijab','ponytail','locs','long','short']):pick(['short','crop','bald','afro','curly','locs','short','crop']);
  if(p.style==='hijab')p.hijab=pick(HIJAB);
  if(['afro','locs'].includes(p.style))p.hairC=pick(['#1B1410','#2E1F17','#4A2E1D']);
  p.name=(f?pick(FN):pick(MN))+' '+pick(SN);
  p.item=pick(['mug','plant','none','mug','bottle','none']); p.itemSide=r()<0.5?-1:1; p.phase=r()*10;
  p.lanyard=r()<0.55; p.lanC=pick(['#2a78d6','#C9302C','#1baf7a','#7F5AA8']); p.pattern=pick(['plain','plain','plain','stripe']); p.trousers=pick(['#2B2F38','#3A3F4B','#1F2633','#4A3B2E','#33475B']);
  return p;
}

/* ============ floor: isometric room ============ */
const TW=60,TH=30,WH=124,MG=26;
let L={desks:[],signs:[],decor:[],Wt:10,Dt:10,X0:2,OX:0,OY:0,LW:800,LH:600,doors:{}};
let AG=new Map(); // key -> visual agent
const P=(gx,gy,z=0)=>[L.OX+(gx-gy)*TW/2,L.OY+(gx+gy)*TH/2-z];
function buildLayout(){
  const teams=getTeams(),total=teams.reduce((a,t)=>a+deskCount(t.id),0);
  const cols=clamp(Math.round(Math.sqrt(Math.max(total,4)*1.5)),4,12),X0=2,per=cols*2;
  const desks=[],signs=[];let y=1;
  for(const t of teams){const n=deskCount(t.id);if(!n)continue;
    signs.push({gx:1.62,gy:y+0.55,t,n});
    for(let p=0;p<Math.ceil(n/per);p++){
      for(let j=0;j<per;j++){const k=p*per+j;if(k>=n)break;const B=j>=cols,c=B?j-cols:j,gx=X0+c,gy=y+(B?1:0);
        desks.push({gx,gy,face:B?'B':'A',t,k,key:t.id+'#'+k,aisle:B?y+2.5:y-0.5,seat:{x:gx+0.5,y:B?gy+0.7:gy+0.33}})}
      y+=3}
  }
  const Wt=X0+cols+1,Dt=Math.max(y,7);
  const doors={wc:{gx:-0.1,gy:1.6,label:'WC'},exit:{gx:-0.1,gy:Dt-1.3,label:'EXIT'}};
  const decor=[{type:'plant',gx:0.4,gy:0.4},{type:'cooler',gx:0.35,gy:2.45},{type:'vend',gx:0.32,gy:Dt-2.55},{type:'plant',gx:Wt-0.45,gy:0.45},{type:'printer',gx:Wt-0.42,gy:Math.max(2.5,Math.floor(Dt/2)+0.5)},{type:'plant',gx:Wt-0.45,gy:Dt-0.5}];
  const OX=MG+Dt*TW/2,OY=MG+WH+16;
  L={desks,signs,decor,Wt,Dt,X0,OX,OY,LW:(Wt+Dt)*TW/2+2*MG,LH:OY+(Wt+Dt)*TH/2+MG,doors,cols};
  const keep=new Map();
  for(const d of desks){let a=AG.get(d.key);
    if(!a)a={key:d.key,k:d.k,p:persona(d.key+(S.langs[+d.t.lang.slice(1)]?.name||'')),loc:'away',act:'idle',actUntil:0,breakUntil:-1,walk:null};
    a.desk=d;a.team=d.t;keep.set(d.key,a)}
  AG=keep;layoutVer++;resize();teleportAll();
}
function agentStart(a){return (live.starts[a.team.id]||[])[a.k]}
function planState(a,m){
  if(live.leave.has(a.key))return 'leave';
  if(live.sick.has(a.key))return 'sick';
  const x=agentStart(a);if(x==null)return 'rest';
  const off=((m-shS(x)*30)%1440+1440)%1440;
  if(shPT(x))return off<shMins(x)?'work':'off';
  return off<240?'work':off<300?'lunch':off<540?'work':'off';
}
function pathFor(a,inward,door){const d=L.doors[door],s=a.desk.seat,cx=0.85,ay=a.desk.aisle;
  const pts=[{x:d.gx,y:d.gy},{x:cx,y:d.gy},{x:cx,y:ay},{x:s.x,y:ay},{x:s.x,y:s.y}];return inward?pts:pts.reverse()}
function startWalk(a,inward,door){a.walk={pts:pathFor(a,inward,door),seg:0,t:0,inward,door};a.loc='walk'}
function teleportAll(){const m=simMin();for(const a of AG.values()){const st=planState(a,m);a.walk=null;a.breakUntil=-1;a.loc=st==='work'?'seated':'away';a.actUntil=0}}
function chooseAct(a,simS){
  const i=Math.floor(simMin()/30)%48,r=liveRes&&liveRes.teams[a.team.id],x=r&&r.iv[i];
  const V=S.ch.voice,C=S.ch.chat,E=S.ch.email,T=S.ch.ticket;
  let fv=0,fc=0,fe=0,ft=0;if(x&&x.n>0){fv=x.busyV/x.n;fc=x.busyC/x.n;fe=x.busyE/x.n;ft=(x.busyT||0)/x.n}
  const tot=fv+fc+fe+ft;if(tot>0.97){const k=0.97/tot;fv*=k;fc*=k;fe*=k;ft*=k}
  const idleDur=tot>0.6?35:tot>0.3?70:150,fi=Math.max(0.03,1-fv-fc-fe-ft);
  const opts=[['voice',fv,V.aht],['chat',fc,C.aht],['email',fe,E.aht],['ticket',ft,T.aht],['idle',fi,idleDur]];
  const w=opts.map(o=>o[1]/o[2]),sw=w.reduce((p,q)=>p+q,0);let u=Math.random()*sw,j=0;
  while(j<opts.length-1&&u>w[j]){u-=w[j];j++}
  a.act=opts[j][0];a.actUntil=simS+opts[j][2]*(0.45+Math.random()*1.1);
}
function updateAgents(dt){
  const m=simMin(),simS=simSec,wsp=2.6*clamp(speed/120,1,5);
  for(const a of AG.values()){
    const st=planState(a,m),onBreak=a.breakUntil>m,want=st==='work'&&!onBreak;
    if(a.loc==='away'&&want)startWalk(a,true,a.lastDoor==='wc'?'wc':'exit');
    else if(a.loc==='seated'&&!want){a.lastDoor=onBreak?'wc':'exit';startWalk(a,false,a.lastDoor)}
    if(a.loc==='walk'){const w=a.walk;let step=wsp*dt;
      while(step>0&&w.seg<w.pts.length-1){const A=w.pts[w.seg],B=w.pts[w.seg+1],len=Math.hypot(B.x-A.x,B.y-A.y)||1e-6,rem=(1-w.t)*len;
        if(step>=rem){step-=rem;w.seg++;w.t=0}else{w.t+=step/len;step=0}}
      a.phase=(a.phase||0)+dt*11;
      if(w.seg>=w.pts.length-1){a.loc=w.inward?'seated':'away';a.walk=null;if(w.inward){a.actUntil=0;if(a.lastDoor==='wc')a.lastDoor=null}}}
    if(a.loc==='seated'){
      if(st==='work'&&!onBreak){const x=agentStart(a),off=((m-shS(x)*30)%1440+1440)%1440,len=shMins(x),edge=off<20||off>len-25||(!shPT(x)&&off>220&&off<320);
        if(!edge&&Math.random()<dt*speed/60/160)a.breakUntil=m+4+Math.random()*6}
      if(simS>=a.actUntil||a.actUntil-simS>4000)chooseAct(a,simS);
    }
  }
}

/* ============ floor drawing ============ */
const cv=$('#cv'),ctxMain=cv.getContext('2d'),bgCv=document.createElement('canvas');let ctx=ctxMain,bgKey='',layoutVer=0;
let CAM={z:1,x:0,y:0};
function resize(){const w=cv.clientWidth||$('#floor').clientWidth,dpr=Math.min(2,window.devicePixelRatio||1);
  cv.width=Math.round(w*dpr);cv.height=Math.round(w*L.LH/L.LW*dpr);cv.style.height=(w*L.LH/L.LW)+'px';clampCam()}
window.addEventListener('resize',()=>resize());
function clampCam(){CAM.z=clamp(CAM.z,1,5);const vw=L.LW/CAM.z,vh=L.LH/CAM.z;CAM.x=clamp(CAM.x,0,L.LW-vw);CAM.y=clamp(CAM.y,0,L.LH-vh);
  cv.style.touchAction=CAM.z>1.01?'none':'pan-y';cv.style.cursor=CAM.z>1.01?'grab':'pointer';$('#zFit')&&($('#zFit').disabled=CAM.z<=1.01)}
function toWorld(cx,cy){const rc=cv.getBoundingClientRect(),s=L.LW/rc.width;return [CAM.x+cx*s/CAM.z,CAM.y+cy*s/CAM.z]}
function zoomAt(f,cx,cy){const [wx,wy]=toWorld(cx,cy);CAM.z=clamp(CAM.z*f,1,5);const rc=cv.getBoundingClientRect(),s=L.LW/rc.width;CAM.x=wx-cx*s/CAM.z;CAM.y=wy-cy*s/CAM.z;clampCam()}
function mix(c1,c2,t){const a=parseInt(c1.slice(1),16),b=parseInt(c2.slice(1),16);
  return `rgb(${Math.round(lerp(a>>16,b>>16,t))},${Math.round(lerp(a>>8&255,b>>8&255,t))},${Math.round(lerp(a&255,b&255,t))})`}
function shade(hex,amt){return amt<0?mix(hex,'#000000',-amt):mix(hex,'#ffffff',amt)}
function nightness(h){if(h<5)return 1;if(h<7)return 1-(h-5)/2;if(h<18.5)return 0;if(h<20.5)return (h-18.5)/2;return 1}
function skyCols(h){const K=[[0,'#0A1330','#1A2550'],[5,'#141D44','#2E3466'],[6.3,'#4C5A9A','#F0A060'],[7.5,'#7FB2E8','#CFE6F7'],[12,'#6FA8E6','#CDE5F8'],[17.5,'#7AAEE6','#E4D9C0'],[19.2,'#4B5A9E','#F08A4B'],[20.6,'#1A2350','#3A3E6A'],[24,'#0A1330','#1A2550']];
  for(let i=0;i<K.length-1;i++)if(h>=K[i][0]&&h<=K[i+1][0]){const t=(h-K[i][0])/(K[i+1][0]-K[i][0]);return [mix(K[i][1],K[i+1][1],t),mix(K[i][2],K[i+1][2],t)]}return [K[0][1],K[0][2]]}
const SKY=(()=>{const r=mulberry(7),b=[];let x=0;while(x<1200){const w=30+r()*60,h=20+r()*70;b.push({x,w,h,lit:[...Array(40)].map(()=>r()<0.4)});x+=w+2+r()*6}return {b}})();
function rr(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
const EDGE='rgba(40,24,12,.45)',OUT='rgba(30,18,10,.6)';
function poly(pts,fill,stroke,lw){ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw||1;ctx.lineJoin='round';ctx.stroke()}}
function lg(x0,y0,x1,y1,stops){const g=ctx.createLinearGradient(x0,y0,x1,y1);stops.forEach(([o,c])=>g.addColorStop(o,c));return g}
function box(x,y,w,d,z,h,c,edge=EDGE){
  poly([P(x,y+d,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x,y+d,z+h)],c[1],edge,0.8);
  poly([P(x+w,y,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x+w,y,z+h)],c[2],edge,0.8);
  poly([P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)],c[0],edge,0.8);
}
const tri=b=>[shade(b,0.14),b,shade(b,-0.24)];
const ST_COL={voice:'#2a78d6',chat:'#eb6834',email:'#1baf7a',ticket:'#6250d6',idle:'#3ccf6e',away:'#f2b53a',sick:'#e34948'};
function floorShadow(x,y,w,d,a=0.2){poly([P(x+0.05,y+0.05),P(x+w+0.08,y+0.05),P(x+w+0.08,y+d+0.1),P(x+0.05,y+d+0.1)],`rgba(10,20,25,${a})`)}
function blob(x,y,rx,a=0.22){ctx.fillStyle=`rgba(10,20,25,${a})`;ctx.beginPath();ctx.ellipse(x,y,rx,rx*0.5,0,0,7);ctx.fill()}
let carpetPat=null,linoPat=null;
function patterns(){if(carpetPat)return;
  const mk=(fn)=>{const c=document.createElement('canvas');c.width=c.height=48;fn(c.getContext('2d'));return ctx.createPattern(c,'repeat')};
  carpetPat=mk(g=>{const r=mulberry(3);for(let i=0;i<700;i++){g.fillStyle=`rgba(${r()<0.5?'255,255,255':'0,0,0'},${0.03+r()*0.06})`;g.fillRect(r()*48,r()*48,1,1)}});
  linoPat=mk(g=>{const r=mulberry(5);for(let i=0;i<160;i++){g.fillStyle=`rgba(120,90,50,${0.05+r()*0.06})`;g.fillRect(r()*48,r()*48,1.5,1)}})}

/* ---------- room ---------- */
function drawRoom(h){
  patterns();
  const n=nightness(h),{Wt,Dt,X0}=L;
  for(let gx=0;gx<Wt;gx++)for(let gy=0;gy<Dt;gy++){const corr=gx<X0,odd=(gx+gy)%2;
    poly([P(gx,gy),P(gx+1,gy),P(gx+1,gy+1),P(gx,gy+1)],corr?(odd?'#E0D2AC':'#D3C49C'):(odd?'#5E908B':'#588882'),corr?'rgba(120,95,60,.25)':'rgba(30,60,58,.25)',0.6)}
  ctx.save();poly([P(X0,0),P(Wt,0),P(Wt,Dt),P(X0,Dt)]);ctx.fillStyle=carpetPat;ctx.fill();poly([P(0,0),P(X0,0),P(X0,Dt),P(0,Dt)]);ctx.fillStyle=linoPat;ctx.fill();ctx.restore();
  // corridor edge strip
  poly([P(X0-0.04,0),P(X0+0.02,0),P(X0+0.02,Dt),P(X0-0.04,Dt)],'#4A6E6A');
  // floor slab edges
  poly([P(0,Dt),P(Wt,Dt),P(Wt,Dt,-12),P(0,Dt,-12)],'#3B2C20');poly([P(Wt,0),P(Wt,Dt),P(Wt,Dt,-12),P(Wt,0,-12)],'#2C2118');
  // contact shadows along the walls
  const ao=(a,b,c,d)=>{const [x0,y0]=a,[x1,y1]=b;ctx.fillStyle=lg(x0,y0,x1,y1,[[0,'rgba(0,0,0,.28)'],[1,'rgba(0,0,0,0)']]);poly([c[0],c[1],d[1],d[0]])};
  ao(P(Wt/2,0),P(Wt/2,0.7),[P(0,0),P(Wt,0)],[P(0,0.7),P(Wt,0.7)]);ao(P(0,Dt/2),P(0.7,Dt/2),[P(0,0),P(0,Dt)],[P(0.7,0),P(0.7,Dt)]);
  // walls
  const wallL=lg(0,P(0,Dt/2,WH)[1],0,P(0,Dt/2,0)[1],[[0,'#DDCCA8'],[1,'#C8B48D']]),wallR=lg(0,P(Wt/2,0,WH)[1],0,P(Wt/2,0,0)[1],[[0,'#F1E6CB'],[1,'#DCCCA8']]);
  poly([P(0,0),P(0,Dt),P(0,Dt,WH),P(0,0,WH)],wallL);poly([P(0,0),P(Wt,0),P(Wt,0,WH),P(0,0,WH)],wallR);
  poly([P(0,0),P(0,Dt),P(0,Dt,34),P(0,0,34)],'#8F6C48');poly([P(0,0),P(Wt,0),P(Wt,0,34),P(0,0,34)],'#AA865B');
  for(const z of [34,37])poly([P(0,0,z),P(Wt,0,z),P(Wt,0,z+2),P(0,0,z+2)],z===34?'#7A593A':'#E9D9B3');
  for(const z of [34,37])poly([P(0,0,z),P(0,Dt,z),P(0,Dt,z+2),P(0,0,z+2)],z===34?'#6A4C31':'#D6C49E');
  poly([P(0,0),P(Wt,0),P(Wt,0,6),P(0,0,6)],'#5B4128');poly([P(0,0),P(0,Dt),P(0,Dt,6),P(0,0,6)],'#4E3722');
  // wainscot panels
  for(let gx=0.25;gx<Wt-0.3;gx+=0.75)poly([P(gx,0,9),P(gx+0.6,0,9),P(gx+0.6,0,29),P(gx,0,29)],null,'rgba(70,45,25,.35)',1);
  for(let gy=0.25;gy<Dt-0.3;gy+=0.75)poly([P(0,gy,9),P(0,gy+0.6,9),P(0,gy+0.6,29),P(0,gy,29)],null,'rgba(60,40,20,.35)',1);
  // wall caps
  poly([P(-0.2,-0.2,WH),P(Wt,-0.2,WH),P(Wt,0,WH),P(0,0,WH)],'#6B4D33');poly([P(-0.2,-0.2,WH),P(0,0,WH),P(0,Dt,WH),P(-0.2,Dt,WH)],'#5A3F29');
  poly([P(Wt,-0.2,WH),P(Wt,0,WH),P(Wt,0,0),P(Wt,-0.2,0)],'#4E3624');poly([P(-0.2,Dt,WH),P(0,Dt,WH),P(0,Dt,0),P(-0.2,Dt,0)],'#3F2B1C');
  drawWindows(h);
  // doors
  for(const dr of Object.values(L.doors)){const c=dr.gy;
    poly([P(0,c-0.44),P(0,c+0.44),P(0,c+0.44,74),P(0,c-0.44,74)],'#5E3E25',EDGE);
    poly([P(0,c-0.36),P(0,c+0.36),P(0,c+0.36,68),P(0,c-0.36,68)],lg(...P(0,c-0.36,40),...P(0,c+0.36,40),[[0,'#B07B4E'],[1,'#94643C']]));
    for(const [a,b,z0,z1] of [[-0.28,0.28,40,62],[-0.28,0.28,8,34]])poly([P(0,c+a,z0),P(0,c+b,z0),P(0,c+b,z1),P(0,c+a,z1)],null,'rgba(60,35,15,.45)',1.2);
    const [kx,ky]=P(0,c+0.26,34);ctx.fillStyle='#F2D27A';ctx.beginPath();ctx.arc(kx,ky,2.2,0,7);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.6;ctx.stroke();
    const [sx,sy]=P(0,c,88),ex=dr.label==='EXIT';ctx.fillStyle=ex?'#1E9E52':'#F6F1E4';rr(sx-17,sy-8,34,14,3);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.8;ctx.stroke();
    if(ex&&n>0.2){ctx.fillStyle=`rgba(60,230,120,${0.25*n})`;ctx.beginPath();ctx.arc(sx,sy-1,22,0,7);ctx.fill()}
    ctx.fillStyle=ex?'#fff':'#2F3540';ctx.font='700 9px Instrument Sans, sans-serif';ctx.textAlign='center';ctx.fillText(dr.label,sx,sy+3)}
  // clock
  const [cx,cy]=P(1,0,94);ctx.fillStyle='rgba(0,0,0,.18)';ctx.beginPath();ctx.ellipse(cx+2,cy+2,15,16,0,0,7);ctx.fill();
  ctx.fillStyle='#FFFDF6';ctx.beginPath();ctx.ellipse(cx,cy,15,16,0,0,7);ctx.fill();ctx.strokeStyle='#3A2A1C';ctx.lineWidth=3;ctx.stroke();
  ctx.fillStyle='#3A2A1C';for(let k=0;k<12;k++){const a=k/12*Math.PI*2;ctx.fillRect(cx+Math.cos(a)*12-0.6,cy+Math.sin(a)*13-0.6,1.2,1.2)}
  // noticeboard
  const nb=Math.min(Dt-3,4.2);poly([P(0,nb-0.55,52),P(0,nb+0.55,52),P(0,nb+0.55,94),P(0,nb-0.55,94)],'#9A7148',EDGE);
  poly([P(0,nb-0.47,56),P(0,nb+0.47,56),P(0,nb+0.47,90),P(0,nb-0.47,90)],'#C9A06A');
  [['#FFF4A8',-0.36,84],['#A8E0FF',0.02,86],['#FFC4C4',0.24,74],['#FFFFFF',-0.18,70],['#D7F5C8',0.2,88]].forEach(([c,o,z])=>{poly([P(0,nb+o,z-12),P(0,nb+o+0.18,z-12),P(0,nb+o+0.18,z),P(0,nb+o,z)],c,'rgba(0,0,0,.15)',0.6);const [px,py]=P(0,nb+o+0.09,z-1.5);ctx.fillStyle='#d33';ctx.beginPath();ctx.arc(px,py,1.1,0,7);ctx.fill()});
  // daylight through the windows
  const day=1-n;
  if(day>0.05&&h>6&&h<20){const sun=(h-6)/14,sx=lerp(-0.4,0.9,sun),reach=2.6+Math.sin(Math.PI*sun)*-1.2;
    for(const [a0,a1] of winSpans()){ctx.fillStyle=lg(...P((a0+a1)/2,0),...P((a0+a1)/2+sx,reach),[[0,`rgba(255,236,170,${0.22*day})`],[1,'rgba(255,236,170,0)']]);
      poly([P(a0,0.02),P(a1,0.02),P(a1+sx,reach),P(a0+sx,reach)])}}
  if(n>0){ctx.fillStyle=`rgba(12,18,45,${0.3*n})`;poly([P(-0.2,-0.2,WH),P(Wt,-0.2,WH),P(Wt,0,0),P(Wt,Dt,0),P(Wt,Dt,-12),P(0,Dt,-12),P(-0.2,Dt,0),P(-0.2,Dt,WH)]);
    // ceiling light pools over the desks
    for(let gy=1.5;gy<Dt-0.5;gy+=3)for(let gx=X0+1;gx<Wt-0.5;gx+=2.5){const [lx,ly]=P(gx,gy),g=ctx.createRadialGradient(lx,ly,4,lx,ly,95);
      g.addColorStop(0,`rgba(255,226,170,${0.2*n})`);g.addColorStop(1,'rgba(255,226,170,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(lx,ly,95,52,0,0,7);ctx.fill()}}

}
function drawRoomDyn(){
  const [cx,cy]=P(1,0,94),mn=simMin(),ha=((mn/60)%12)/12*Math.PI*2-Math.PI/2,ma=(mn%60)/60*Math.PI*2-Math.PI/2;
  ctx.strokeStyle='#3A2A1C';ctx.lineCap='round';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(ha)*7,cy+Math.sin(ha)*7);ctx.stroke();
  ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(ma)*11,cy+Math.sin(ma)*11);ctx.stroke();
  if(incidentOn()){const fl=(performance.now()/400|0)%2;ctx.fillStyle=`rgba(220,30,30,${fl?0.1:0.03})`;ctx.fillRect(0,0,L.LW,L.LH);
    for(const g of [1.9,L.Wt-0.6]){const [bx,by]=P(g,0,WH-6);ctx.fillStyle='#3a3f47';ctx.fillRect(bx-5,by-2,10,5);ctx.fillStyle=fl?'#FF3B30':'#8A1C17';ctx.beginPath();ctx.arc(bx,by-6,6,Math.PI,0);ctx.fill();
      if(fl){const rg=ctx.createRadialGradient(bx,by-6,2,bx,by-6,40);rg.addColorStop(0,'rgba(255,60,50,.55)');rg.addColorStop(1,'rgba(255,60,50,0)');ctx.fillStyle=rg;ctx.fillRect(bx-40,by-46,80,80)}}}
}
function winSpans(){const a=[];for(let a0=L.X0+0.2;a0+1.25<=L.Wt-0.15;a0+=1.7)a.push([a0,a0+1.3]);return a}
function drawWindows(h){
  const n=nightness(h),[top,bot]=skyCols(h),z0=48,z1=WH-14,left=P(L.X0,0)[0],right=P(L.Wt,0)[0];
  for(const [a0,a1] of winSpans()){const pts=[P(a0,0,z0),P(a1,0,z0),P(a1,0,z1),P(a0,0,z1)];
    poly([P(a0-0.06,0,z0-4),P(a1+0.06,0,z0-4),P(a1+0.06,0,z1+4),P(a0-0.06,0,z1+4)],'#F6F0E2',EDGE);
    ctx.save();poly(pts);ctx.clip();
    const yT=pts[3][1],yB=pts[1][1];ctx.fillStyle=lg(0,yT,0,yB,[[0,top],[1,bot]]);ctx.fillRect(pts[0][0],yT-2,pts[1][0]-pts[0][0],yB-yT+4);
    const base=x=>pts[0][1]+(x-pts[0][0])*0.5;
    if(h>=6&&h<=20){const t=(h-6)/14,sx=lerp(left,right,t),sy=base(sx)-10-Math.sin(Math.PI*t)*(z1-z0-22);
      const sg=ctx.createRadialGradient(sx,sy,2,sx,sy,34);sg.addColorStop(0,'rgba(255,240,190,.95)');sg.addColorStop(1,'rgba(255,240,190,0)');ctx.fillStyle=sg;ctx.fillRect(sx-34,sy-34,68,68);
      ctx.fillStyle='#FFF6D2';ctx.beginPath();ctx.arc(sx,sy,8,0,7);ctx.fill()}
    else{const hh=h<6?h+24:h,t=(hh-20)/10,mx=lerp(left,right,t),my=base(mx)-12-Math.sin(Math.PI*t)*(z1-z0-24);
      ctx.fillStyle='#EEF0F8';ctx.beginPath();ctx.arc(mx,my,7,0,7);ctx.fill();ctx.fillStyle=top;ctx.beginPath();ctx.arc(mx+3.5,my-2,6,0,7);ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.7)';for(let k=0;k<14;k++){const sx=pts[0][0]+((k*37)%60)/60*(pts[1][0]-pts[0][0]);ctx.fillRect(sx,base(sx)-20-((k*53)%40),1,1)}}
    for(const far of [0,1])for(const b of SKY.b){const bx=left+((b.x+far*40)%1200)/1200*(right-left),bw=b.w*(far?0.22:0.32),bh=b.h*(far?0.62:0.42);if(bx+bw<pts[0][0]||bx>pts[1][0])continue;
      const y1=base(bx)+2,y2=base(bx+bw)+2;poly([[bx,y1],[bx+bw,y2],[bx+bw,y2-bh],[bx,y1-bh]],far?mix('#B9C7D6','#1C2440',n):mix('#98AABE','#121829',n));
      if(!far&&n>0.2){ctx.fillStyle=`rgba(255,214,120,${0.85*n})`;let k=0;for(let wy=6;wy<bh-3;wy+=6)for(let wx=3;wx<bw-3;wx+=5){if(b.lit[k++%40])ctx.fillRect(bx+wx,y1+wx*0.5-wy,2,3)}}}
    // blinds at the top, glass sheen
    for(let k=0;k<4;k++){const z=z1-2-k*3;poly([P(a0,0,z),P(a1,0,z),P(a1,0,z-1.6),P(a0,0,z-1.6)],'rgba(245,242,232,.92)')}
    ctx.fillStyle='rgba(255,255,255,.14)';poly([P(a0+0.15,0,z0),P(a0+0.35,0,z0),P(a0+0.75,0,z1),P(a0+0.55,0,z1)]);
    ctx.restore();
    poly(pts,null,'#5E4630',1);const mid=(a0+a1)/2,[mx1,my1]=P(mid,0,z0),[mx2,my2]=P(mid,0,z1);ctx.strokeStyle='#F6F0E2';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(mx1,my1);ctx.lineTo(mx2,my2);ctx.stroke();
    box(a0-0.08,0,a1-a0+0.16,0.14,z0-5,3,tri('#F3EEE2'));
  }
}

/* ---------- people ---------- */
function blinkOn(p,t){return ((t+p.phase*3.7)%4.6)<0.13}
function hairFill(p,x,y,r){return lg(x-r,y-r,x+r*0.6,y+r,[[0,shade(p.hairC,0.22)],[1,p.hairC]])}
function drawHead(x,y,r,p,o={}){
  const fx=(o.turn||0)*r,t=o.t||0,skinG=ctx.createRadialGradient(x-r*0.35+fx*0.3,y-r*0.4,r*0.15,x,y,r*1.15);
  skinG.addColorStop(0,shade(p.skin,0.14));skinG.addColorStop(0.65,p.skin);skinG.addColorStop(1,shade(p.skin,-0.14));
  const hf=hairFill(p,x,y,r);ctx.fillStyle=hf;ctx.strokeStyle=OUT;ctx.lineWidth=0.9;
  if(p.style==='hijab'){ctx.fillStyle=lg(x-r,y-r,x+r,y+r*1.5,[[0,shade(p.hijab,0.18)],[1,shade(p.hijab,-0.1)]]);ctx.beginPath();ctx.ellipse(x,y+r*0.35,r*1.32,r*1.52,0,0,7);ctx.fill();ctx.stroke()}
  else if(p.style==='long'){rr(x-r*1.1,y-r*0.6,r*2.2,r*2.3,r*0.9);ctx.fill();ctx.stroke()}
  else if(p.style==='bob'){rr(x-r*1.13,y-r*0.7,r*2.26,r*1.8,r*0.9);ctx.fill();ctx.stroke()}
  else if(p.style==='afro'){ctx.beginPath();ctx.arc(x,y-r*0.25,r*1.45,0,7);ctx.fill();ctx.stroke()}
  else if(p.style==='curly'){for(let k=0;k<8;k++){const a=Math.PI+k/7*Math.PI;ctx.beginPath();ctx.arc(x+Math.cos(a)*r*0.95,y-r*0.1+Math.sin(a)*r*0.95,r*0.45,0,7);ctx.fill();ctx.stroke()}}
  else if(p.style==='locs'){ctx.lineWidth=r*0.3;ctx.strokeStyle=p.hairC;ctx.lineCap='round';for(let k=-3;k<=3;k++){ctx.beginPath();ctx.moveTo(x+k*r*0.3,y-r*0.5);ctx.lineTo(x+k*r*0.36,y+r*(1.3-Math.abs(k)*0.1));ctx.stroke()}}
  else if(p.style==='ponytail'){ctx.beginPath();ctx.ellipse(x-fx*2.4+r*0.95*(fx>0?-1:1),y+r*0.1,r*0.35,r*0.75,0.3,0,7);ctx.fill();ctx.stroke()}
  // neck & ears
  ctx.fillStyle=shade(p.skin,-0.12);ctx.fillRect(x-r*0.3,y+r*0.62,r*0.6,r*0.55);
  if(p.style!=='hijab'){ctx.fillStyle=p.skin;ctx.strokeStyle=OUT;ctx.lineWidth=0.8;for(const sx of [-1,1]){ctx.beginPath();ctx.ellipse(x+sx*r*0.92+fx*0.2,y+r*0.08,r*0.2,r*0.27,0,0,7);ctx.fill();ctx.stroke()}}
  ctx.fillStyle=skinG;ctx.beginPath();ctx.ellipse(x,y,r*0.95,r,0,0,7);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.9;ctx.stroke();
  // front hair
  ctx.fillStyle=hf;
  if(p.style==='hijab'){ctx.strokeStyle=shade(p.hijab,0.05);ctx.lineWidth=r*0.42;ctx.beginPath();ctx.ellipse(x,y,r*1.05,r*1.13,0,0,7);ctx.stroke();ctx.strokeStyle=OUT;ctx.lineWidth=0.8;ctx.beginPath();ctx.ellipse(x,y,r*0.84,r*0.92,0,0,7);ctx.stroke()}
  else if(p.style==='bun'){ctx.beginPath();ctx.arc(x,y-r*1.12,r*0.45,0,7);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.8;ctx.stroke();ctx.beginPath();ctx.ellipse(x,y-r*0.45,r*0.99,r*0.62,0,Math.PI,0);ctx.fill()}
  else if(p.style!=='bald'){const th=p.style==='crop'?0.45:p.style==='afro'?0.75:0.62;ctx.beginPath();ctx.ellipse(x,y-r*0.38,r*0.99,r*th,0,Math.PI,0);ctx.fill();
    if(['long','bob','short','ponytail'].includes(p.style)){ctx.beginPath();ctx.ellipse(x-r*0.32+fx,y-r*0.45,r*0.6,r*0.3,-0.3,0,7);ctx.fill()}
    ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=r*0.12;ctx.beginPath();ctx.arc(x-r*0.1,y-r*0.3,r*0.7,Math.PI*1.2,Math.PI*1.55);ctx.stroke()}
  else{ctx.fillStyle='rgba(255,255,255,.25)';ctx.beginPath();ctx.ellipse(x-r*0.3,y-r*0.6,r*0.3,r*0.15,-0.4,0,7);ctx.fill()}
  // brows, eyes, nose
  const ey=y+(o.look?r*0.1:0)-r*0.02,bl=blinkOn(p,t);
  ctx.strokeStyle=shade(p.hairC==='#9A9A9A'?'#6a6a6a':p.hairC,-0.1);ctx.lineWidth=r*0.11;ctx.lineCap='round';
  for(const sx of [-1,1]){ctx.beginPath();ctx.moveTo(x+sx*r*0.47+fx,ey-r*0.27);ctx.lineTo(x+sx*r*0.18+fx,ey-r*(o.talk?0.33:0.3));ctx.stroke()}
  for(const sx of [-1,1]){const ex=x+sx*r*0.32+fx;
    if(bl){ctx.strokeStyle='#2a1a12';ctx.lineWidth=r*0.08;ctx.beginPath();ctx.moveTo(ex-r*0.13,ey);ctx.lineTo(ex+r*0.13,ey);ctx.stroke();continue}
    ctx.fillStyle='#FFFFFF';ctx.beginPath();ctx.ellipse(ex,ey,r*0.17,r*0.13,0,0,7);ctx.fill();
    ctx.fillStyle='#3A2418';ctx.beginPath();ctx.arc(ex+fx*0.12,ey+(o.look?r*0.03:0),r*0.095,0,7);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ex+fx*0.12-r*0.03,ey-r*0.03,r*0.03,0,7);ctx.fill()}
  ctx.strokeStyle=shade(p.skin,-0.28);ctx.lineWidth=r*0.07;ctx.beginPath();ctx.arc(x+fx*1.15+r*0.04,y+r*0.12,r*0.12,-0.3,1.6);ctx.stroke();
  ctx.fillStyle='rgba(235,110,110,.22)';ctx.beginPath();ctx.arc(x-r*0.55+fx,y+r*0.3,r*0.17,0,7);ctx.arc(x+r*0.55+fx,y+r*0.3,r*0.17,0,7);ctx.fill();
  if(p.beard){ctx.fillStyle=hf;ctx.beginPath();ctx.ellipse(x+fx*0.5,y+r*0.45,r*0.74,r*0.52,0,0,Math.PI);ctx.fill();ctx.beginPath();ctx.ellipse(x+fx,y+r*0.32,r*0.32,r*0.09,0,0,7);ctx.fill()}
  if(o.talk){const op=Math.abs(Math.sin(o.talk));ctx.fillStyle='#5a2320';ctx.beginPath();ctx.ellipse(x+fx,y+r*0.47,r*0.2,r*(0.05+0.13*op),0,0,7);ctx.fill();
    if(op>0.4){ctx.fillStyle='#fff';ctx.fillRect(x+fx-r*0.12,y+r*0.47-r*(0.05+0.13*op)+0.3,r*0.24,r*0.05)}}
  else{ctx.strokeStyle='#6a2c26';ctx.lineWidth=r*0.09;ctx.beginPath();ctx.arc(x+fx,y+r*0.3,r*0.22,0.25,Math.PI-0.25);ctx.stroke()}
  if(p.glasses){ctx.strokeStyle='#1d1d1d';ctx.lineWidth=r*0.09;ctx.fillStyle='rgba(180,220,255,.18)';
    for(const sx of [-1,1]){ctx.beginPath();ctx.ellipse(x+sx*r*0.32+fx,ey,r*0.25,r*0.21,0,0,7);ctx.fill();ctx.stroke()}
    ctx.beginPath();ctx.moveTo(x-r*0.07+fx,ey);ctx.lineTo(x+r*0.07+fx,ey);ctx.stroke()}
  if(o.headset)headset(x,y,r,o.talk,true);
}
function headset(x,y,r,talk,front){
  ctx.strokeStyle='#1d2126';ctx.lineWidth=r*0.22;ctx.lineCap='round';ctx.beginPath();ctx.ellipse(x,y-r*0.05,r*1.08,r*1.12,0,Math.PI*1.04,Math.PI*1.96);ctx.stroke();
  ctx.strokeStyle='#4a5260';ctx.lineWidth=r*0.07;ctx.beginPath();ctx.ellipse(x,y-r*0.08,r*1.08,r*1.12,0,Math.PI*1.2,Math.PI*1.5);ctx.stroke();
  for(const sx of [-1,1]){ctx.fillStyle=lg(x+sx*r,y-r*0.3,x+sx*r*1.2,y+r*0.3,[[0,'#3a414b'],[1,'#16191d']]);rr(x+sx*r*1.06-r*0.2,y-r*0.33,r*0.4,r*0.68,r*0.15);ctx.fill();
    ctx.fillStyle='#55606e';rr(x+sx*r*1.06-r*0.12,y-r*0.2,r*0.24,r*0.4,r*0.08);ctx.fill()}
  if(front){ctx.strokeStyle='#1d2126';ctx.lineWidth=r*0.1;ctx.beginPath();ctx.moveTo(x-r*1.05,y+r*0.25);ctx.quadraticCurveTo(x-r*0.95,y+r*0.78,x-r*0.32,y+r*0.62);ctx.stroke();
    ctx.fillStyle=talk?'#3ccf6e':'#2b3038';ctx.beginPath();ctx.arc(x-r*0.29,y+r*0.62,r*0.15,0,7);ctx.fill();
    if(talk){ctx.fillStyle='rgba(60,207,110,.35)';ctx.beginPath();ctx.arc(x-r*0.29,y+r*0.62,r*0.3,0,7);ctx.fill()}}
}
function drawHeadBack(x,y,r,p,hs){
  ctx.strokeStyle=OUT;ctx.lineWidth=0.9;
  if(p.style==='hijab'){ctx.fillStyle=lg(x-r,y-r,x+r,y+r*1.5,[[0,shade(p.hijab,0.18)],[1,shade(p.hijab,-0.12)]]);ctx.beginPath();ctx.ellipse(x,y+r*0.3,r*1.3,r*1.5,0,0,7);ctx.fill();ctx.stroke();if(hs)headset(x,y,r,0,false);return}
  ctx.fillStyle=shade(p.skin,-0.12);ctx.fillRect(x-r*0.32,y+r*0.6,r*0.64,r*0.6);
  for(const sx of [-1,1]){ctx.fillStyle=p.skin;ctx.beginPath();ctx.ellipse(x+sx*r*0.92,y+r*0.08,r*0.2,r*0.27,0,0,7);ctx.fill();ctx.stroke()}
  ctx.fillStyle=p.skin;ctx.beginPath();ctx.ellipse(x,y,r*0.95,r,0,0,7);ctx.fill();ctx.stroke();
  const hf=hairFill(p,x,y,r);ctx.fillStyle=hf;
  if(p.style==='afro'){ctx.beginPath();ctx.arc(x,y-r*0.2,r*1.45,0,7);ctx.fill();ctx.stroke()}
  else if(p.style==='long'){rr(x-r*1.05,y-r*0.95,r*2.1,r*2.5,r*0.9);ctx.fill();ctx.stroke()}
  else if(p.style==='bob'){rr(x-r*1.05,y-r*0.95,r*2.1,r*1.9,r*0.9);ctx.fill();ctx.stroke()}
  else if(p.style==='locs'){ctx.beginPath();ctx.ellipse(x,y-r*0.1,r*0.98,r*0.95,0,0,7);ctx.fill();ctx.lineWidth=r*0.3;ctx.strokeStyle=p.hairC;ctx.lineCap='round';for(let k=-3;k<=3;k++){ctx.beginPath();ctx.moveTo(x+k*r*0.3,y);ctx.lineTo(x+k*r*0.34,y+r*1.4);ctx.stroke()}}
  else if(p.style!=='bald'){ctx.beginPath();ctx.ellipse(x,y-r*0.12,r*0.97,r*(p.style==='crop'?0.82:0.92),0,0,7);ctx.fill();ctx.stroke();
    if(p.style==='bun'){ctx.beginPath();ctx.arc(x,y-r*0.9,r*0.48,0,7);ctx.fill();ctx.stroke()}
    if(p.style==='ponytail'){ctx.beginPath();ctx.ellipse(x,y+r*0.9,r*0.3,r*0.7,0,0,7);ctx.fill();ctx.stroke()}
    if(p.style==='curly'){for(let k=0;k<6;k++){const a=k/6*Math.PI*2;ctx.beginPath();ctx.arc(x+Math.cos(a)*r*0.8,y-r*0.1+Math.sin(a)*r*0.8,r*0.38,0,7);ctx.fill()}}}
  if(p.style!=='bald'){ctx.strokeStyle='rgba(255,255,255,.2)';ctx.lineWidth=r*0.12;ctx.beginPath();ctx.arc(x,y-r*0.2,r*0.7,Math.PI*1.15,Math.PI*1.5);ctx.stroke()}
  if(hs)headset(x,y,r,0,false);
}
function torso(x,y,p,front,h=22,w=11){
  const g=lg(x-w,y-h,x+w,y,[[0,shade(p.shirt,0.12)],[0.6,p.shirt],[1,shade(p.shirt,-0.2)]]);
  ctx.beginPath();ctx.moveTo(x-w,y);ctx.lineTo(x-w,y-h*0.62);ctx.quadraticCurveTo(x-w,y-h*0.95,x-w*0.45,y-h);ctx.lineTo(x+w*0.45,y-h);ctx.quadraticCurveTo(x+w,y-h*0.95,x+w,y-h*0.62);ctx.lineTo(x+w,y);ctx.closePath();
  ctx.fillStyle=g;ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.9;ctx.stroke();
  if(p.pattern==='stripe'){ctx.save();ctx.clip();ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=1.2;for(let k=-w;k<w;k+=4){ctx.beginPath();ctx.moveTo(x+k,y-h);ctx.lineTo(x+k,y);ctx.stroke()}ctx.restore()}
  if(front){ctx.fillStyle=shade(p.skin,-0.06);ctx.beginPath();ctx.moveTo(x-w*0.35,y-h);ctx.lineTo(x,y-h*0.68);ctx.lineTo(x+w*0.35,y-h);ctx.fill();
    ctx.fillStyle=shade(p.shirt,0.25);ctx.beginPath();ctx.moveTo(x-w*0.5,y-h);ctx.lineTo(x-w*0.05,y-h*0.66);ctx.lineTo(x-w*0.3,y-h*0.62);ctx.closePath();ctx.moveTo(x+w*0.5,y-h);ctx.lineTo(x+w*0.05,y-h*0.66);ctx.lineTo(x+w*0.3,y-h*0.62);ctx.closePath();ctx.fill();
    if(p.lanyard){ctx.strokeStyle=p.lanC;ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(x-w*0.38,y-h*0.98);ctx.lineTo(x-1,y-h*0.38);ctx.lineTo(x+w*0.38,y-h*0.98);ctx.stroke();
      ctx.fillStyle='#fff';rr(x-3.2,y-h*0.42,6.4,7.5,1);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.5;ctx.stroke();ctx.fillStyle=p.lanC;ctx.fillRect(x-3.2,y-h*0.42,6.4,2)}}
  else{ctx.strokeStyle='rgba(0,0,0,.15)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y-h*0.9);ctx.lineTo(x,y);ctx.stroke()}
}
function drawSitter(x,y,p,front,o){
  const r=9.6,t=o.t;
  if(!front){ // elbows out, reaching for the keyboard
    const ty=Math.sin(t*14+p.phase)*(o.typing?0.8:0);
    for(const sx of [-1,1]){ctx.fillStyle=shade(p.shirt,-0.1);rr(x+sx*12-3.5,y-17+(sx>0?ty:-ty),7,13,3.5);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.8;ctx.stroke()}}
  torso(x,y,p,front);
  if(front){for(const sx of [-1,1]){ctx.fillStyle=shade(p.shirt,-0.08);rr(x+sx*11.5-3.2,y-16,6.4,13,3.2);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.8;ctx.stroke();
      ctx.fillStyle=p.skin;ctx.beginPath();ctx.arc(x+sx*11.2,y-2.5,2.9,0,7);ctx.fill();ctx.stroke()}
    drawHead(x,y-22-r*0.58,r,p,{headset:true,talk:o.talk,look:o.look,turn:-0.16,t})}
  else drawHeadBack(x,y-22-r*0.58,r,p,true);
}

/* ---------- furniture & kit ---------- */
function chairBase(cx,cy){const [x,y]=P(cx,cy,1);blob(x,y+1,11,0.2);ctx.strokeStyle='#23272e';ctx.lineWidth=2;ctx.lineCap='round';
  for(let k=0;k<5;k++){const a=k/5*Math.PI*2+0.3,[ex,ey]=P(cx+Math.cos(a)*0.17,cy+Math.sin(a)*0.17,1.5);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.stroke();ctx.fillStyle='#14171b';ctx.beginPath();ctx.arc(ex,ey+1,1.6,0,7);ctx.fill()}
  const [,y2]=P(cx,cy,10);ctx.strokeStyle='#5b636e';ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y2);ctx.stroke()}
const CHAIR='#4F64A0';
function chairSeat(cx,cy){box(cx-0.21,cy-0.17,0.42,0.34,10,5,[shade(CHAIR,0.22),shade(CHAIR,-0.05),shade(CHAIR,-0.3)])}
function chairBack(cx,y,jacket){box(cx-0.2,y,0.4,0.07,17,24,[shade(CHAIR,0.15),CHAIR,shade(CHAIR,-0.3)]);
  const ln=[P(cx-0.14,y+0.07,22),P(cx+0.14,y+0.07,22),P(cx+0.14,y+0.07,36),P(cx-0.14,y+0.07,36)];poly(ln,'rgba(255,255,255,.08)');
  if(jacket)box(cx-0.22,y-0.01,0.44,0.09,24,15,tri(shade(jacket,-0.15)),'rgba(0,0,0,.3)')}
function deskBox(x,y,w,d){
  floorShadow(x,y,w,d,0.22);
  // legs/modesty panel
  box(x+0.03,y+0.03,w-0.06,d-0.06,0,15,tri('#8E6034'));
  // top
  box(x,y,w,d,15,3,['#E9BB80','#C78F55','#9C6A38']);
  const g=lg(...P(x,y,18),...P(x+w,y+d,18),[[0,'rgba(255,255,255,.18)'],[0.5,'rgba(255,255,255,0)'],[1,'rgba(90,50,20,.12)']]);
  poly([P(x,y,18),P(x+w,y,18),P(x+w,y+d,18),P(x,y+d,18)],g);
  ctx.strokeStyle='rgba(120,70,30,.18)';ctx.lineWidth=0.6;for(let k=1;k<4;k++){const [a,b]=P(x+0.05,y+d*k/4,18),[c,e]=P(x+w-0.05,y+d*k/4+0.02,18);ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,e);ctx.stroke()}
}
function screenContent(F,kind,t,ph,primary){
  const q=(u0,v0,u1,v1,c)=>poly([F(u0,v0),F(u1,v0),F(u1,v1),F(u0,v1)],c);
  if(kind==='off'){q(0,0,1,1,'#0E1116');q(0.1,0.2,0.3,1,'rgba(255,255,255,.05)');return}
  q(0,0,1,1,'#EEF3F9');
  const hc=ST_COL[kind]||'#7d8a99';q(0,0.82,1,1,primary?hc:'#5d6b7c');
  if(!primary){for(let k=0;k<4;k++)q(0.06,0.66-k*0.17,k%2?0.7:0.94,0.74-k*0.17,'#cdd7e3');return}
  if(kind==='voice'){q(0.07,0.38,0.27,0.72,'#2a78d6');for(let k=0;k<6;k++){const hk=0.06+0.18*Math.abs(Math.sin(t*7+k*1.3+ph));q(0.36+k*0.1,0.52-hk,0.42+k*0.1,0.52+hk,'#2a78d6')}q(0.07,0.08,0.6,0.2,'#e34948')}
  else if(kind==='chat'){q(0.06,0.56,0.56,0.74,'#d6dee8');q(0.42,0.32,0.94,0.5,'#eb6834');q(0.06,0.08,0.5,0.26,'#d6dee8');if((t*2|0)%2)q(0.62,0.1,0.9,0.22,'#f3c4ad')}
  else if(kind==='ticket'){for(let k=0;k<3;k++){q(0.05,0.62-k*0.24,0.95,0.78-k*0.24,k===0?'#dcd6fb':'#d6dee8');q(0.08,0.66-k*0.24,0.2,0.74-k*0.24,'#6250d6')}}
  else if(kind==='email'){for(let k=0;k<4;k++)q(0.05,0.66-k*0.18,0.95,0.76-k*0.18,k===1?'#bfe8d8':'#d6dee8');q(0.05,0.66-0.18,0.1,0.76-0.18,'#1baf7a')}
  else {q(0.06,0.44,0.46,0.76,'#cfe0f3');q(0.54,0.44,0.94,0.76,'#d6f0e0');q(0.06,0.08,0.94,0.36,'#e2e8ef');q(0.1,0.12,0.9,0.18,'#b8c6d6')}
  q(0.08,0.0,0.22,1,'rgba(255,255,255,.12)');
}
function monitorUnit(x,y,front,kind,t,ph,primary,glow){
  const w=0.36,d=0.04,zb=24,h=15;
  const [sx,sy]=P(x+w/2,y+d/2,18);
  box(x+w/2-0.07,y-0.04,0.14,0.1,18,1.2,tri('#3a3f47'));
  ctx.fillStyle='#2b3038';ctx.fillRect(sx-1.4,sy-(zb-18)-1,2.8,zb-18+1);
  if(glow){const [gx2,gy2]=P(x+w/2,y+d,zb+h/2),g=ctx.createRadialGradient(gx2,gy2+4,1,gx2,gy2+4,16);g.addColorStop(0,`rgba(170,210,255,${glow})`);g.addColorStop(1,'rgba(170,210,255,0)');ctx.fillStyle=g;ctx.fillRect(gx2-16,gy2-12,32,32)}
  box(x,y,w,d,zb,h,['#3d434c','#24292f','#1a1e23'],'rgba(0,0,0,.55)');
  const F=(u,v)=>P(x+0.025+u*(w-0.05),y+d,zb+1.5+v*(h-3));
  if(front)screenContent(F,kind,t,ph,primary);
  else{const G=(u,v)=>P(x+u*w,y+d,zb+v*h);poly([G(0.38,0.4),G(0.62,0.4),G(0.62,0.62),G(0.38,0.62)],'#2f353d');const [lx,ly]=G(0.5,0.75);ctx.fillStyle='rgba(255,255,255,.25)';ctx.beginPath();ctx.arc(lx,ly,1.2,0,7);ctx.fill()}
}
function keyboard(x,y){box(x,y,0.36,0.1,18,1.4,['#E7E9EC','#C4C7CC','#A7ABB1'],'rgba(0,0,0,.25)');
  ctx.strokeStyle='rgba(80,85,95,.35)';ctx.lineWidth=0.6;for(let k=1;k<4;k++){const [a,b]=P(x+0.02,y+k*0.025,19.4),[c,e]=P(x+0.34,y+k*0.025,19.4);ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(c,e);ctx.stroke()}}
function mouse(x,y){const [mx,my]=P(x,y,18.5);ctx.fillStyle='#D9DCE0';ctx.beginPath();ctx.ellipse(mx,my,2.4,1.5,-0.45,0,7);ctx.fill();ctx.strokeStyle='rgba(0,0,0,.3)';ctx.lineWidth=0.5;ctx.stroke()}
function deskItem(a,gx,gy,t){if(!a)return;const it=a.p.item,[x,y]=P(gx,gy,18);
  if(it==='mug'){ctx.fillStyle=lg(x-3,0,x+3,0,[[0,'#ffffff'],[1,'#d8d6cf']]);rr(x-3,y-7,6,7,1.5);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.5;ctx.stroke();ctx.fillStyle='#4a2c1a';ctx.beginPath();ctx.ellipse(x,y-7,2.6,0.9,0,0,7);ctx.fill();
    ctx.strokeStyle='#e9e7e0';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(x+3.6,y-3.5,2,-1.4,1.4);ctx.stroke();
    if(((t+a.p.phase)%9)<4){ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(x,y-8);ctx.bezierCurveTo(x-2,y-11,x+2,y-12,x,y-15);ctx.stroke()}}
  else if(it==='plant'){ctx.fillStyle='#B4683E';rr(x-3,y-6,6,6,1);ctx.fill();ctx.fillStyle='#3F8A4E';ctx.beginPath();ctx.ellipse(x-2,y-9,2.4,3.8,-0.4,0,7);ctx.ellipse(x+2,y-10,2.4,3.8,0.4,0,7);ctx.fill();ctx.fillStyle='#5FB06A';ctx.beginPath();ctx.ellipse(x,y-11,1.6,3,0,0,7);ctx.fill()}
  else if(it==='bottle'){ctx.fillStyle=lg(x-2,0,x+2,0,[[0,'#9bd3ee'],[1,'#4f9fc4']]);rr(x-2,y-11,4,11,1.5);ctx.fill();ctx.fillStyle='#2a6f93';ctx.fillRect(x-1.3,y-12.5,2.6,1.6)}
  else{poly([P(gx-0.06,gy-0.05,18.3),P(gx+0.08,gy-0.05,18.3),P(gx+0.08,gy+0.06,18.3),P(gx-0.06,gy+0.06,18.3)],'#FBFBF7','rgba(0,0,0,.15)',0.5)}}
function lamp(gx,gy,status,t){const [x,y]=P(gx,gy,34.5),col=status?ST_COL[status]:null;
  if(!col){ctx.fillStyle='#5b6470';rr(x-3.5,y-1.6,7,3.2,1.6);ctx.fill();return}
  const g=ctx.createRadialGradient(x,y,1,x,y,9);g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');ctx.globalAlpha=0.5;ctx.fillStyle=g;ctx.fillRect(x-9,y-9,18,18);ctx.globalAlpha=1;
  ctx.fillStyle=shade(col,0.25);rr(x-4,y-2,8,4,2);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.5;ctx.stroke()}
function lampOld(gx,gy,status,t){const [x,y]=P(gx,gy,18),[,y2]=P(gx,gy,46);
  ctx.fillStyle='#2b3038';ctx.beginPath();ctx.ellipse(x,y,2.6,1.3,0,0,7);ctx.fill();
  ctx.strokeStyle='#3a3f47';ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y2);ctx.stroke();
  const col=status?ST_COL[status]:'#4a4f57';
  if(status){const g=ctx.createRadialGradient(x,y2-3,1,x,y2-3,10);g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');ctx.globalAlpha=0.45;ctx.fillStyle=g;ctx.fillRect(x-10,y2-13,20,20);ctx.globalAlpha=1}
  ctx.fillStyle=lg(x-3,y2-6,x+3,y2,[[0,status?shade(col,0.4):'#666'],[1,col]]);rr(x-3,y2-7,6,6,2.5);ctx.fill();ctx.strokeStyle=OUT;ctx.lineWidth=0.6;ctx.stroke()}
function bubble(x,y,status,t,ph){const bx=x+6,by=y-64,bw=19,bh=13;
  ctx.fillStyle='rgba(0,0,0,.18)';rr(bx+1.5,by+1.5,bw,bh,4.5);ctx.fill();
  ctx.fillStyle=ST_COL[status];rr(bx,by,bw,bh,4.5);ctx.fill();ctx.beginPath();ctx.moveTo(bx+3,by+bh-0.5);ctx.lineTo(bx+1,by+bh+5);ctx.lineTo(bx+8,by+bh-0.5);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1;rr(bx+0.5,by+0.5,bw-1,bh-1,4);ctx.stroke();
  ctx.fillStyle='#fff';ctx.strokeStyle='#fff';ctx.lineWidth=1.2;
  if(status==='voice'){for(let k=0;k<4;k++){const hh=2+4*Math.abs(Math.sin(t*6+k+ph));rr(bx+3.8+k*3.4,by+bh/2-hh/2,2,hh,1);ctx.fill()}}
  else if(status==='chat'){for(let k=0;k<3;k++){ctx.globalAlpha=((Math.floor(t*3)%3)===k)?1:0.45;ctx.beginPath();ctx.arc(bx+5.5+k*4,by+bh/2,1.5,0,7);ctx.fill()}ctx.globalAlpha=1}
  else if(status==='ticket'){ctx.beginPath();ctx.moveTo(bx+4,by+3);ctx.lineTo(bx+15,by+3);ctx.lineTo(bx+15,by+5.3);ctx.arc(bx+15,by+bh/2,1.2,-Math.PI/2,Math.PI/2,true);ctx.lineTo(bx+15,by+bh-3);ctx.lineTo(bx+4,by+bh-3);ctx.lineTo(bx+4,by+7.7);ctx.arc(bx+4,by+bh/2,1.2,Math.PI/2,-Math.PI/2,true);ctx.closePath();ctx.stroke();ctx.fillRect(bx+7,by+5.6,5,1.2)}
  else{ctx.strokeRect(bx+4.5,by+3.2,10,6.6);ctx.beginPath();ctx.moveTo(bx+4.5,by+3.2);ctx.lineTo(bx+9.5,by+7);ctx.lineTo(bx+14.5,by+3.2);ctx.stroke()}}
function note(pts,col){poly(pts,col,'rgba(0,0,0,.2)',0.6)}
function drawDesk(d,t){
  const a=AG.get(d.key),m=simMin(),st=planState(a,m),seated=a.loc==='seated';
  const on=st==='work'||st==='lunch',status=seated?a.act:st==='sick'?'sick':st==='leave'?null:on?'away':null,gx=d.gx,gy=d.gy,s=d.seat;
  const glow=on?nightness(m/60)*0.22:0,[px,py]=P(s.x,s.y,16),jacket=st==='lunch'&&!seated?a.p.shirt:null;
  const kind1=!on?'off':seated?a.act:'idle',typing=seated&&(a.act==='chat'||a.act==='email'||a.act==='ticket');
  const person=front=>{if(seated)drawSitter(px,py,a.p,front,{talk:a.act==='voice'?t*9+a.p.phase:0,look:a.act!=='voice',t,typing})};
  if(d.face==='A'){
    chairBack(s.x,gy+0.06,jacket);chairBase(s.x,s.y);chairSeat(s.x,s.y);person(true);
    deskBox(gx+0.04,gy+0.52,0.92,0.44);
    deskItem(a,gx+0.86,gy+0.86,t);
    monitorUnit(gx+0.1,gy+0.56,false,kind1,t,a.p.phase,true,0);monitorUnit(gx+0.52,gy+0.56,false,kind1,t,a.p.phase,false,0);
    if(st==='sick')note([P(gx+0.2,gy+0.74,18.4),P(gx+0.4,gy+0.74,18.4),P(gx+0.4,gy+0.9,18.4),P(gx+0.2,gy+0.9,18.4)],'#FFE36E');
    if(st==='leave')note([P(gx+0.2,gy+0.74,18.4),P(gx+0.4,gy+0.74,18.4),P(gx+0.4,gy+0.9,18.4),P(gx+0.2,gy+0.9,18.4)],'#9FD8F5');
    box(gx,gy+0.965,1,0.035,0,32,tri('#7FA0B4'),'rgba(0,0,0,.35)');box(gx,gy+0.955,1,0.055,32,1.6,tri('#C9CED4'),'rgba(0,0,0,.3)');
    lamp(gx+0.3,gy+0.982,status,t);
  }else{
    deskBox(gx+0.04,gy+0.04,0.92,0.44);
    lamp(gx+0.7,gy-0.018,status,t);
    monitorUnit(gx+0.1,gy+0.26,true,kind1,t,a.p.phase,false,glow);monitorUnit(gx+0.52,gy+0.26,true,kind1,t,a.p.phase,true,glow);
    keyboard(gx+0.32,gy+0.34);mouse(gx+0.78,gy+0.4);deskItem(a,gx+0.14,gy+0.4,t);
    if(st==='sick')note([P(gx+0.36,gy+0.36,19.6),P(gx+0.56,gy+0.36,19.6),P(gx+0.56,gy+0.46,19.6),P(gx+0.36,gy+0.46,19.6)],'#FFE36E');
    if(st==='leave')note([P(gx+0.36,gy+0.36,19.6),P(gx+0.56,gy+0.36,19.6),P(gx+0.56,gy+0.46,19.6),P(gx+0.36,gy+0.46,19.6)],'#9FD8F5');
    chairBase(s.x,s.y);chairSeat(s.x,s.y);person(false);chairBack(s.x,gy+0.88,jacket);
  }
  if(seated&&['voice','chat','email','ticket'].includes(status))bubble(px,py,status,t,a.p.phase);
  if(selectedKey===d.key)poly([P(gx,gy),P(gx+1,gy),P(gx+1,gy+1),P(gx,gy+1)],null,'#FFB238',2.5);
}
function drawWalker(a,t){
  const w=a.walk,A=w.pts[w.seg],B=w.pts[Math.min(w.seg+1,w.pts.length-1)],gx=lerp(A.x,B.x,w.t),gy=lerp(A.y,B.y,w.t);
  const [x,y]=P(gx,gy),dx=B.x-A.x,dy=B.y-A.y,front=dx+dy>=0,p=a.p;
  const end=w.inward?w.pts[0]:w.pts[w.pts.length-1],dd=Math.hypot(gx-end.x,gy-end.y);
  ctx.save();ctx.globalAlpha=dd<0.45?dd/0.45:1;blob(x,y,9,0.24);
  const sw=Math.sin(a.phase||0)*4.5,bob=Math.abs(Math.cos(a.phase||0))*1.2,yy=y-bob;
  for(const [lx,ph] of [[-3,sw],[3,-sw]]){ctx.strokeStyle=p.trousers;ctx.lineWidth=4.6;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x+lx,yy-15);ctx.lineTo(x+lx+ph,y-3);ctx.stroke();
    ctx.fillStyle='#1b1d22';ctx.beginPath();ctx.ellipse(x+lx+ph+(front?-0.5:0.5),y-1.6,3,1.7,0,0,7);ctx.fill()}
  for(const sx of [-1,1]){if(front!==(sx<0))continue}
  const arm=(sx)=>{ctx.strokeStyle=shade(p.shirt,-0.1);ctx.lineWidth=4.4;ctx.beginPath();ctx.moveTo(x+sx*9,yy-31);ctx.lineTo(x+sx*10-sx*0+sw*0.8*sx,yy-19);ctx.stroke();ctx.fillStyle=p.skin;ctx.beginPath();ctx.arc(x+sx*10+sw*0.8*sx,yy-17.5,2.5,0,7);ctx.fill()};
  arm(front?1:-1);
  torso(x,yy-14,p,front,21,10);
  arm(front?-1:1);
  if(front)drawHead(x,yy-44,9,p,{turn:dx>dy?0.2:-0.2,t});else drawHeadBack(x,yy-44,9,p,false);
  ctx.restore();
}
function drawDecor(o,t){const {gx,gy}=o;
  if(o.type==='plant'){const [x,y]=P(gx,gy);blob(x,y+1,14,0.25);box(gx-0.17,gy-0.17,0.34,0.34,0,18,tri('#C2703D'));box(gx-0.19,gy-0.19,0.38,0.38,18,3,tri('#A85E2E'));
    const [lx,ly]=P(gx,gy,26);const L2=[[0,-16,6,13,0],[-9,-4,5,12,-0.7],[9,-5,5,12,0.7],[-5,4,5,10,-1.2],[6,5,5,10,1.2],[-2,-24,4,9,-0.2],[4,-20,4,9,0.4]];
    for(const [dx,dy,rw,rh,ang] of L2){ctx.fillStyle=lg(lx+dx,ly+dy-rh,lx+dx,ly+dy+rh,[[0,'#6CC072'],[1,'#2F6B38']]);ctx.beginPath();ctx.ellipse(lx+dx,ly+dy,rw,rh,ang,0,7);ctx.fill();
      ctx.strokeStyle='rgba(20,60,30,.5)';ctx.lineWidth=0.6;ctx.stroke();ctx.beginPath();ctx.moveTo(lx+dx-Math.sin(ang)*rh*0.8,ly+dy+Math.cos(ang)*rh*0.8);ctx.lineTo(lx+dx+Math.sin(ang)*rh*0.8,ly+dy-Math.cos(ang)*rh*0.8);ctx.stroke()}}
  else if(o.type==='cooler'){const [x0,y0]=P(gx,gy);blob(x0,y0,11,0.22);box(gx-0.17,gy-0.17,0.34,0.34,0,32,tri('#F1F1EE'));
    const [x,y]=P(gx,gy,46);ctx.fillStyle=lg(x-8,0,x+8,0,[[0,'rgba(170,220,250,.95)'],[1,'rgba(90,160,215,.95)']]);rr(x-8,y-12,16,20,6);ctx.fill();ctx.strokeStyle='rgba(40,90,140,.6)';ctx.lineWidth=0.8;ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.55)';ctx.fillRect(x-5,y-9,2,14);const bub=((t*1.3)%1);ctx.fillStyle='rgba(255,255,255,.7)';ctx.beginPath();ctx.arc(x+2,y+6-bub*16,1.2,0,7);ctx.fill();
    for(const [k,c] of [[-0.06,'#2a78d6'],[0.06,'#e34948']]){const [tx,ty]=P(gx+0.17,gy+k,22);ctx.fillStyle=c;ctx.fillRect(tx-1.5,ty-2,3,3)}}
  else if(o.type==='vend'){const [x0,y0]=P(gx,gy);blob(x0,y0,18,0.25);box(gx-0.25,gy-0.42,0.5,0.84,0,64,tri('#C9302C'));
    const f=gx+0.25;poly([P(f,gy-0.34,16),P(f,gy+0.18,16),P(f,gy+0.18,56),P(f,gy-0.34,56)],'#1E2731');
    const cs=['#F2C14E','#5BC0EB','#9BC53D','#E55934','#FFFFFF','#B184F0'];for(let r=0;r<5;r++)for(let c=0;c<4;c++){const [x,y]=P(f,gy-0.29+c*0.12,51-r*7.5);ctx.fillStyle=cs[(r*4+c)%6];rr(x-1.6,y-3.5,3.2,4.5,1);ctx.fill()}
    poly([P(f,gy-0.3,16),P(f,gy-0.05,16),P(f,gy+0.2,56),P(f,gy-0.05,56)],'rgba(255,255,255,.1)');
    poly([P(f,gy+0.23,24),P(f,gy+0.37,24),P(f,gy+0.37,50),P(f,gy+0.23,50)],'#2c2f33');const [ex,ey]=P(f,gy+0.3,46);ctx.fillStyle='#6CF59A';ctx.fillRect(ex-2,ey-1.5,4,2.5)}
  else if(o.type==='printer'){const [x0,y0]=P(gx,gy);blob(x0,y0,16,0.22);box(gx-0.3,gy-0.26,0.6,0.52,0,26,tri('#ECECE8'));box(gx-0.22,gy-0.2,0.44,0.34,26,3,tri('#3a3f47'));
    poly([P(gx-0.14,gy+0.26,18),P(gx+0.14,gy+0.26,18),P(gx+0.14,gy+0.4,16.5),P(gx-0.14,gy+0.4,16.5)],'#FFFFFF','rgba(0,0,0,.2)',0.6);
    const [lx,ly]=P(gx+0.3,gy-0.1,20);ctx.fillStyle=(t%2)<1?'#3ccf6e':'#2a8f4c';ctx.fillRect(lx-1.5,ly-1.5,3,3)}
}
function drawSign(sg){const [x,y]=P(sg.gx,sg.gy),[,y2]=P(sg.gx,sg.gy,40);blob(x,y+1,8,0.25);
  ctx.fillStyle='#3d2c20';ctx.beginPath();ctx.ellipse(x,y,5,2.5,0,0,7);ctx.fill();
  ctx.strokeStyle='#5A4030';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y2);ctx.stroke();
  ctx.font='700 10px Instrument Sans, sans-serif';const l1=sg.t.label.toUpperCase(),l2=sg.n+' DESKS',w=Math.max(ctx.measureText(l1).width,ctx.measureText(l2).width)+16;
  ctx.fillStyle='rgba(0,0,0,.25)';rr(x-w/2+2,y2-30,w,30,5);ctx.fill();
  ctx.fillStyle=lg(0,y2-32,0,y2-2,[[0,'#2E3C4E'],[1,'#1E2836']]);rr(x-w/2,y2-32,w,30,5);ctx.fill();ctx.strokeStyle='#F2D27A';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#F7F1E1';ctx.textAlign='center';ctx.fillText(l1,x,y2-19);ctx.fillStyle='#F2D27A';ctx.font='600 9px JetBrains Mono, monospace';ctx.fillText(l2,x,y2-8)}
function drawScene(t){
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#1C2128';ctx.fillRect(0,0,cv.width,cv.height);
  const k=cv.width/L.LW*CAM.z,key=[cv.width,cv.height,layoutVer,CAM.z.toFixed(3),CAM.x.toFixed(1),CAM.y.toFixed(1),Math.floor(simMin()/5)].join('|');
  if(key!==bgKey){bgKey=key;bgCv.width=cv.width;bgCv.height=cv.height;ctx=bgCv.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,bgCv.width,bgCv.height);
    ctx.setTransform(k,0,0,k,-CAM.x*k,-CAM.y*k);try{drawRoom(simMin()/60)}finally{ctx=ctxMain}}
  ctx.drawImage(bgCv,0,0);
  ctx.setTransform(k,0,0,k,-CAM.x*k,-CAM.y*k);drawRoomDyn();
  const items=[];
  for(const d of L.desks)items.push([d.gx+0.5+d.gy+(d.face==='A'?0.75:0.8),()=>drawDesk(d,t)]);
  for(const o of L.decor)items.push([o.gx+o.gy,()=>drawDecor(o,t)]);
  for(const sg of L.signs)items.push([sg.gx+sg.gy,()=>drawSign(sg)]);
  for(const a of AG.values())if(a.loc==='walk'){const w=a.walk,A=w.pts[w.seg],B=w.pts[Math.min(w.seg+1,w.pts.length-1)];items.push([lerp(A.x,B.x,w.t)+lerp(A.y,B.y,w.t),()=>drawWalker(a,t)])}
  items.sort((p,q)=>p[0]-q[0]);for(const it of items)it[1]();
  if(!L.desks.length){ctx.fillStyle='#fff';ctx.font='600 16px Instrument Sans, sans-serif';ctx.textAlign='center';ctx.fillText('No agents rostered yet',L.LW/2,L.LH/2)}
}

/* ============ popover ============ */
let selectedKey=null;
const PTR=new Map();let downAt=null,pinch0=null;
function pickDesk(cx,cy){const [x,y]=toWorld(cx,cy);let best=null,bd=26;
  for(const d of L.desks){const [px,py]=P(d.seat.x,d.seat.y,16),dist=Math.hypot(x-px,y-(py-22));if(dist<bd){bd=dist;best=d}}return best}
cv.addEventListener('pointerdown',e=>{const rc=cv.getBoundingClientRect();PTR.set(e.pointerId,[e.clientX-rc.left,e.clientY-rc.top]);
  if(PTR.size===1){downAt={x:e.clientX,y:e.clientY,cx:CAM.x,cy:CAM.y,moved:false};if(CAM.z>1.01)cv.setPointerCapture(e.pointerId)}
  if(PTR.size===2){const [a,b]=[...PTR.values()];pinch0={d:Math.hypot(a[0]-b[0],a[1]-b[1]),z:CAM.z};downAt&&(downAt.moved=true)}});
cv.addEventListener('pointermove',e=>{if(!PTR.has(e.pointerId))return;const rc=cv.getBoundingClientRect();PTR.set(e.pointerId,[e.clientX-rc.left,e.clientY-rc.top]);
  if(PTR.size===2&&pinch0){const [a,b]=[...PTR.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);zoomAt(pinch0.z*d/pinch0.d/CAM.z,(a[0]+b[0])/2,(a[1]+b[1])/2);return}
  if(!downAt)return;const dx=e.clientX-downAt.x,dy=e.clientY-downAt.y;if(Math.hypot(dx,dy)>5)downAt.moved=true;
  if(downAt.moved&&CAM.z>1.01){const s2=L.LW/rc.width/CAM.z;CAM.x=downAt.cx-dx*s2;CAM.y=downAt.cy-dy*s2;clampCam();cv.style.cursor='grabbing';closePop()}});
const endPtr=e=>{const was=downAt;PTR.delete(e.pointerId);if(PTR.size<2)pinch0=null;if(PTR.size)return;downAt=null;clampCam();
  if(e.type==='pointerup'&&was&&!was.moved){const rc=cv.getBoundingClientRect(),cx=e.clientX-rc.left,cy=e.clientY-rc.top,best=pickDesk(cx,cy);
    if(!best){closePop();return}selectedKey=best.key;showPop(best,cx,cy)}};
cv.addEventListener('pointerup',endPtr);cv.addEventListener('pointercancel',endPtr);
cv.addEventListener('wheel',e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const rc=cv.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*0.01),e.clientX-rc.left,e.clientY-rc.top);closePop()},{passive:false});
cv.addEventListener('dblclick',e=>{const rc=cv.getBoundingClientRect();zoomAt(CAM.z>=4?1/CAM.z:2,e.clientX-rc.left,e.clientY-rc.top);closePop()});
$('#zIn').onclick=()=>{zoomAt(1.6,cv.clientWidth/2,cv.clientHeight/2);closePop()};
$('#zOut').onclick=()=>{zoomAt(1/1.6,cv.clientWidth/2,cv.clientHeight/2);closePop()};
$('#zFit').onclick=()=>{CAM={z:1,x:0,y:0};clampCam();closePop()};
function showPop(d,px,py){
  const a=AG.get(d.key),pop=$('#pop'),st=planState(a,simMin()),x0=agentStart(a),s0=x0==null?0:shS(x0)*30;
  const desc={work:a.loc==='seated'?({voice:'On a call',chat:'Handling chats',email:'Working on emails',ticket:'Working on self-service tickets',idle:'Ready for the next contact'}[a.act]):(a.breakUntil>simMin()?'On a short break':'Walking to their desk'),lunch:'On lunch',off:'Not on shift right now',sick:'Off sick today',leave:'On annual leave today',rest:'Rest day (works 5 days in 7)'}[st];
  const shift=st==='rest'?'Not rostered today':(st==='sick'||st==='leave')?'Shift uncovered':(shPT(x0)?`Part-time shift ${shLabel(x0)}`:`Shift ${hhmm(s0)}–${hhmm(s0+540)}, lunch ${hhmm(s0+240)}–${hhmm(s0+300)}`);
  pop.innerHTML=`<h4>${a.p.name}</h4><div class="meta">${a.team.label} team · ${desc}<br>${shift}</div>
  <div class="row">${st==='sick'?'<button class="btn" id="pBack">Back to work</button>':(st==='rest'||st==='leave')?'':'<button class="btn" id="pSick">Send home sick</button>'}<button class="btn ghost" id="pClose">Close</button></div>`;
  pop.hidden=false;const fw=$('#floor').clientWidth;pop.style.left=clamp(px+12,8,fw-240)+'px';pop.style.top=clamp(py-20,8,$('#floor').clientHeight-150)+'px';
  $('#pClose').onclick=closePop;
  if($('#pSick'))$('#pSick').onclick=()=>{live.sick.add(a.key);afterLiveChange();closePop()};
  if($('#pBack'))$('#pBack').onclick=()=>{live.sick.delete(a.key);afterLiveChange();closePop()};
}
function closePop(){$('#pop').hidden=true;selectedKey=null}

/* ============ sim clock ============ */
let simSec=9*3600,speed=240,playing=true;
const simMin=()=>simSec/60;
if(matchMedia('(prefers-reduced-motion: reduce)').matches)playing=false;
function advance(sec){simSec+=sec;if(simSec>=86400){simSec-=86400;if(liveSum)MTD.hist[MTD.date]=tally(47,1);EV=new Map();MTD.date++;if(MTD.date>MONTH_DAYS){MTD.date=1;MTD.hist={}}live.dow=(live.dow+1)%7;$('#daySel').value=live.dow;resetLive(false);evalLive();buildMTD();teleportAll();scheduleMC(true)}}

/* ============ wallboard ============ */
function cls(v,tgt,lowerBetter){if(v==null||!isFinite(v))return 'led-g';const d=lowerBetter?tgt-v:v-tgt;return d>=0?'led-g':d>-0.05?'led-a':'led-r'}
let wbState={waiting:0,longest:0,cw:0,next:0};
function soFar(arrOff,arrSla,i,frac){let o=0,s=0;for(let j=0;j<i;j++){o+=arrOff[j];s+=arrSla[j]}o+=arrOff[i]*frac;s+=arrSla[i]*frac;return o>0?s/o:null}
function poisson(l){if(l<=0)return 0;if(l>30)return Math.max(0,Math.round(l+Math.sqrt(l)*gauss()));let L=Math.exp(-l),k=0,p=1;do{k++;p*=Math.random()}while(p>L);return k-1}
/* ---- month to date: a 30-day month; earlier days come from the model, days played through are kept as they happened ---- */
let MTD={date:1,hist:{},prior:null};
// A change to the model (volumes, targets, staffing...) restarts the simulated month: day 1, start of the day, fresh absences.
let simReset=false;
function doSimReset(){EV=new Map();MTD.date=1;MTD.hist={};simSec=(S.h24?0:Math.max(0,((S.openFrom||0)+23)%24))*3600;resetLive(false);wbState.next=0}
const MONTH_DAYS=30;
function zeroTot(){const o={};for(const c of CH)o[c]={off:0,sla:0,ab:0};return o}
function dayTot(sum){const o={};for(const c of CH)o[c]={off:sum.ch[c].off,sla:sum.ch[c].sla,ab:sum.ch[c].ab};return o}
function modelDay(dow,seed){if(!S.openDays[dow])return zeroTot();const r=mulberry(seed);let u=0;while(!u)u=r();const z=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*r());
  return dayTot(summarise(evalDay(dow,clamp(1+S.fcErr/100*z,0.6,1.6),plannedSched(dow),null,attend())))}
function buildMTD(){const base=hashStr(JSON.stringify({...S,name:''})),tot=zeroTot();
  for(let d=1;d<MTD.date;d++){const dow=((live.dow-(MTD.date-d))%7+7)%7,x=MTD.hist[d]||zeroTot();for(const c of CH)for(const k of ['off','sla','ab'])tot[c][k]+=x[c][k]}
  MTD.prior=tot}
/* The live board counts whole contacts. When the clock first reaches a half hour, its arrivals are drawn from the model
   (a Poisson count around the expected number) and each contact gets an arrival time and a definite outcome.
   Once drawn, a half hour never changes, so a later sick call or incident only affects what's still to come. */
let EV=new Map();
function poissonR(l){if(l<=0)return 0;if(l>40)return Math.max(0,Math.round(l+Math.sqrt(l)*gauss()));const L=Math.exp(-l);let k=0,p=1;do{k++;p*=Math.random()}while(p>L);return k-1}
function drawIv(i){
  const V=liveSum.iv.voice,C=liveSum.iv.chat,Em=liveSum.iv.email,out={voice:[],chat:[],email:[]};
  const pick=(sl,ab)=>{const u=Math.random();return u<sl?'sl':u<sl+ab?'ab':'late'};
  for(const l of activeLangs()){const x=liveSum.ivLang[l.key];if(!x||!(x.off[i]>0))continue;
    const n=poissonR(x.off[i]),sl=x.sla[i]/x.off[i],ab=V.off[i]>0?Math.min(1-sl,V.ab[i]/V.off[i]):0;
    for(let k=0;k<n;k++)out.voice.push({t:Math.random(),o:pick(sl,ab),L:l.key})}
  if(C.off[i]>0){const n=poissonR(C.off[i]),sl=C.sla[i]/C.off[i],ab=Math.min(1-sl,C.ab[i]/C.off[i]);for(let k=0;k<n;k++)out.chat.push({t:Math.random(),o:pick(sl,ab)})}
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
function todaySoFar(i,fr){return tally(i,fr)}
function renderWallboard(now){
  if(!liveSum)return;
  const m=simMin(),i=Math.floor(m/30)%48,fr=(m%30)/30,V=liveSum.iv.voice,C=liveSum.iv.chat;
  if(now>wbState.next||now<wbState.next-10){wbState.next=now+2;wbState.waiting=poisson(V.lq[i]);wbState.cw=poisson(C.lq[i]);
    const w=V.off[i]>0?V.w[i]/V.off[i]:0;wbState.longest=wbState.waiting>0?w*(0.6+0.5*Math.log(1+wbState.waiting))*(0.8+Math.random()*0.4):0}
  const E=S.ch,TD=tally(i,fr),rt=(x,k)=>x.off>0?x[k]/x.off:null,vsl=rt(TD.voice,'sla'),vab=rt(TD.voice,'ab'),csl=rt(TD.chat,'sla');
  const cnt={voice:0,chat:0,email:0,ticket:0,idle:0,brk:0,lunch:0,sick:live.sick.size,leave:live.leave.size};
  for(const a of AG.values()){const st=planState(a,m);if(st==='lunch')cnt.lunch++;else if(st==='work'){if(a.breakUntil>m)cnt.brk++;else if(a.loc==='seated')cnt[a.act]++}}
  const cells=[],td=TD,mt=zeroTot();if(MTD.prior)for(const c of CH)for(const k of ['off','sla','ab'])mt[c][k]=MTD.prior[c][k]+td[c][k];
  const rate=(x,k)=>x.off>0?x[k]/x.off:null,mVsl=rate(mt.voice,'sla'),mVab=rate(mt.voice,'ab'),mCsl=rate(mt.chat,'sla'),mEsl=rate(mt.email,'sla'),mTsl=rate(mt.ticket,'sla');
  if(incidentOn())cells.push(`<div class="wb-cell wide alert"><div class="wb-label" style="color:#ff8a7a">Status</div><div class="wb-val led-r blink">MAJOR INCIDENT</div><div class="wb-sub" style="color:#ffb0a5">Call volume doubled since ${hhmm(live.incident.from*30)}${live.incident.to<48?` · ends ${hhmm(live.incident.to*30)}`:''}</div></div>`);
  cells.push(`<div class="wb-cell"><div class="wb-label">${DOW[live.dow]} · Interval</div><div class="wb-val led-a">${hhmm(m)}</div><div class="wb-sub">${hhmm(i*30)}–${hhmm(i*30+30)}</div></div>`);
  if(E.voice.on){
    const langs=activeLangs().filter(l=>liveSum.ivLang[l.key]).map(l=>{const x=TD.lang[l.key],v=x&&x.off?x.sla/x.off:null;return l.name.slice(0,2).toUpperCase()+' '+(v==null?'–':Math.round(v*100))}).join(' · ');
    cells.push(`<div class="wb-cell"><div class="wb-label">Calls waiting${S.shared?' · pool':''}</div><div class="wb-val ${wbState.waiting>5?'led-r':wbState.waiting>1?'led-a':'led-g'}">${wbState.waiting}</div><div class="wb-sub">Longest ${mss(wbState.longest)}</div></div>`);
    cells.push(`<div class="wb-cell"><div class="wb-label">Calls SL today</div><div class="wb-val ${cls(vsl,E.voice.slPct/100)}">${vsl==null?'––':pct(vsl)}</div><div class="wb-sub">Tgt ${E.voice.slPct}/${E.voice.slSec}s · ${langs}</div></div>`);
    cells.push(`<div class="wb-cell"><div class="wb-label">Calls SL month to date</div><div class="wb-val ${cls(mVsl,E.voice.slPct/100)}">${mVsl==null?'––':pct(mVsl)}</div><div class="wb-sub">Day ${MTD.date} of ${MONTH_DAYS} · ${fmtN(mt.voice.off)} offered</div></div>`);
    const co=TD.voice.off,ca=TD.voice.ab,cs=TD.voice.sla;
    cells.push(`<div class="wb-cell wide"><div class="wb-label">Calls today · MTD ${fmtN(mt.voice.off-mt.voice.ab)} handled</div><div class="wb-trio"><div><span class="wb-val led-g">${fmtN(co)}</span><span class="wb-sub">offered</span></div><div><span class="wb-val led-g">${fmtN(co-ca)}</span><span class="wb-sub">handled</span></div><div><span class="wb-val led-g">${fmtN(cs)}</span><span class="wb-sub">in ${E.voice.slSec}s</span></div><div><span class="wb-val ${ca>0.5?'led-a':'led-g'}">${fmtN(ca)}</span><span class="wb-sub">abandoned</span></div></div></div>`);
    cells.push(`<div class="wb-cell"><div class="wb-label">Abandoned</div><div class="wb-val ${cls(vab,S.abTarget/100,true)}">${vab==null?'––':pct(vab)}</div><div class="wb-sub">${S.model==='C'?'Erlang C: none modelled':`Max ${S.abTarget}% · MTD <span class="${cls(mVab,S.abTarget/100,true)}">${mVab==null?'––':pct(mVab)}</span> · ${fmtN(mt.voice.ab)} lost`}</div></div>`);
  }
  if(E.chat.on)cells.push(`<div class="wb-cell"><div class="wb-label">Chats waiting${S.shared?' · pool':''}</div><div class="wb-val ${wbState.cw>4?'led-r':wbState.cw>1?'led-a':'led-g'}">${wbState.cw}</div><div class="wb-sub">SL today ${csl==null?'––':pct(csl,0)} · MTD <span class="${cls(mCsl,E.chat.slPct/100)}">${mCsl==null?'––':pct(mCsl,0)}</span> · tgt ${E.chat.slPct}%<br>${fmtN(TD.chat.off)} chat${TD.chat.off===1?'':'s'} so far</div></div>`);
  if(E.email.on){const bl=liveSum.iv.email.backlog[i],esl=rt(TD.email,'sla');
    cells.push(`<div class="wb-cell"><div class="wb-label">Email queue</div><div class="wb-val ${cls(esl,E.email.slPct/100)}">${Math.round(bl)}</div><div class="wb-sub">${esl==null?'Today –– ('+TD.email.off+' in)':'Today '+pct(esl,0)+' in '+E.email.slHrs+'h'} · MTD <span class="${cls(mEsl,E.email.slPct/100)}">${mEsl==null?'––':pct(mEsl,0)}</span> · tgt ${E.email.slPct}%</div></div>`)}
  if(E.ticket.on){const bl=liveSum.iv.ticket.backlog[i],tsl=rt(TD.ticket,'sla');
    cells.push(`<div class="wb-cell"><div class="wb-label">Ticket queue</div><div class="wb-val ${cls(tsl,E.ticket.slPct/100)}">${Math.round(bl)}</div><div class="wb-sub">${tsl==null?'Today –– ('+TD.ticket.off+' in)':'Today '+pct(tsl,0)+' in '+E.ticket.slHrs+'h'} · MTD <span class="${cls(mTsl,E.ticket.slPct/100)}">${mTsl==null?'––':pct(mTsl,0)}</span> · tgt ${E.ticket.slPct}%</div></div>`)}
  cells.push(`<div class="wb-cell wide"><div class="wb-label">Agents</div><div class="wb-agents">
    ${E.voice.on?`<span><b>CALL</b>${cnt.voice}</span>`:''}${E.chat.on?`<span><b>CHAT</b>${cnt.chat}</span>`:''}${E.email.on?`<span><b>MAIL</b>${cnt.email}</span>`:''}${E.ticket.on?`<span><b>TKT</b>${cnt.ticket}</span>`:''}
    <span><b>READY</b>${cnt.idle}</span><span class="led-a"><b>BRK</b>${cnt.brk}</span><span class="led-a"><b>LUNCH</b>${cnt.lunch}</span><span class="${cnt.sick?'led-r':''}"><b>SICK</b>${cnt.sick}</span><span><b>LEAVE</b>${cnt.leave}</span></div></div>`);
  $('#wb').innerHTML=cells.join('');
}
function updateTicker(){
  if(!MC.day)return;const d=MC.day,V=S.ch.voice,bits=[];
  bits.push(`${DOW[live.dow].toUpperCase()} FORECAST: ${CH.filter(c=>S.ch[c].on).map(c=>fmtN(d.exp.ch[c].off)+' '+CHN[c].toUpperCase()).join(' · ')}`);
  if(V.on&&d.P.voice!=null)bits.push(`${Math.round(d.P.voice*100)}% CHANCE OF HITTING ${V.slPct}/${V.slSec} TODAY`);
  if(live.sick.size||live.leave.size)bits.push(`${live.sick.size} OFF SICK · ${live.leave.size} ON LEAVE${live.replanned?' · ROTA REPLANNED':''}`);
  const tot=getTeams().reduce((a,t)=>a+rosterSize(t.id,live.dow),0);bits.push(`${tot} AGENTS ON TODAY'S ROTA`);
  if(live.incident)bits.unshift(incidentOn()&&live.incident.to<48?'MAJOR INCIDENT ENDING AT '+hhmm(live.incident.to*30)+': VOLUMES RETURNING TO NORMAL':incidentOn()?'MAJOR INCIDENT IN PROGRESS: CALL VOLUMES DOUBLED. ALL AVAILABLE AGENTS PLEASE STAY ON THE PHONES':'MAJOR INCIDENT RESOLVED AT '+hhmm(live.incident.to*30));
  bits.push('REMEMBER TO SET YOUR STATUS WHEN YOU GO ON BREAK');
  $('#ticker').textContent=bits.join('   ★   ');
}

/* ============ report ============ */
let MC={},repPeriod='week';
function pill(p,label){if(p==null)return '<span class="pill na">No volume</span>';
  const c=p>=0.8?'good':p>=0.5?'warn':'bad',ic=c==='good'?'<path d="M2 6l3 3 5-6"/>':c==='warn'?'<path d="M6 2v5M6 9.5v.5"/>':'<path d="M3 3l6 6M9 3l-6 6"/>';
  return `<span class="pill ${c}"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ic}</svg>${p<0.01?'<1%':p>0.99?'>99%':Math.round(p*100)+'%'} ${label||'likely'}</span>`}
function renderReport(){
  const r=MC[repPeriod];if(!r){$('#verdict').innerHTML='<span class="busy">Simulating…</span>';return}
  const E=S.ch,on=CH.filter(c=>E[c].on&&r.exp.ch[c].off>0),pname={day:'today',week:'this week',month:'this month'}[repPeriod];
  // verdict
  const unit={day:'days',week:'weeks',month:'months'}[repPeriod];
  const checks=on.map(c=>{const x=r.exp.ch[c];return {c,p:r.P[c],name:{voice:'call',chat:'chat',email:'email',ticket:'ticket'}[c]+' target',exp:x.sla/x.off,tgt:E[c].slPct/100,
    tgtTxt:DEFER.includes(c)?`${E[c].slPct}% within ${E[c].slHrs}h`:`${E[c].slPct}% in ${E[c].slSec}s`}});
  if(E.voice.on&&r.P.ab!=null){const x=r.exp.ch.voice;if(S.model==='A')checks.push({c:'ab',p:r.P.ab,name:'abandon limit',exp:x.ab/x.off,tgt:S.abTarget/100,tgtTxt:`at most ${S.abTarget}%`})}
  const worst=checks.reduce((w,x)=>!w||x.p<w.p?x:w,null);
  const count=p=>{const n=Math.round(p*500);return n===0?'None':n===500?'All':String(n)};
  const expTxt=w=>`Expected ${pct(w.exp)} against a target of ${w.tgtTxt}.`;
  const short=sizing(REC).tot.contract-sizing(S.hc).tot.contract;
  const fix=()=>repPeriod==='day'&&live.incident?'The major incident is driving this. End it from the top bar, or add agents for the day.'
    :short>0?`The rota is ${short} FTE short of the recommendation. Choose Use recommended in Desk set-up to close the gap.`
    :repPeriod==='day'&&live.sick.size&&!live.replanned?'Absence is the likely cause. Try Replan remaining shifts in Desk set-up.'
    :'Add agents in Desk set-up, or loosen the target in Demand & targets.';
  let vt,vc,vp;
  if(!worst){vt='No contacts forecast';vc='var(--muted)';vp='Add some volume in Demand & targets.'}
  else if(worst.p>=0.8){vt=`On track to hit every target ${pname}`;vc='var(--good)';vp=`The tightest is the ${worst.name}: ${count(worst.p)==='All'?'all':count(worst.p)} of 500 simulated ${unit} hit it. ${expTxt(worst)}`}
  else if(worst.p>=0.5){vt=`${CHN[worst.c]?CHN[worst.c]:'Abandon rate'} at risk ${pname}`;vc='var(--warn)';vp=`${count(worst.p)} of 500 simulated ${unit} hit the ${worst.name}. ${expTxt(worst)} ${fix()}`}
  else{vt=`${worst.c==='ab'?'Abandon rate':CHN[worst.c]} likely to miss target ${pname}`;vc='var(--bad)';vp=`${count(worst.p)} of 500 simulated ${unit} hit the ${worst.name}. ${expTxt(worst)} ${fix()}`}
  $('#verdict').innerHTML=`<span class="dot" style="background:${vc}"></span><div><b>${vt}</b><p>${vp}</p></div>`;
  // SLA summary: every contracted metric bucketed by how likely it is to be met over the period, with the explanation and rota facts
  const nRisk=checks.filter(x=>x.p<0.8).length,nMiss=checks.filter(x=>x.p<0.5).length,nAt=nRisk-nMiss;
  const head=!checks.length?'No SLA metrics to check':nRisk===0?`All ${checks.length} SLA metrics on track ${pname}`
    :`${nRisk} of ${checks.length} SLA metric${checks.length>1?'s':''} at risk of penalty ${pname}`;
  const detail=nRisk?[nMiss?`${nMiss} likely to miss`:'',nAt?`${nAt} at risk`:''].filter(Boolean).join(', ')+'. ':'';
  const occ=r.exp.avail>0?r.exp.busy/r.exp.avail:0;
  $('#scorecard').innerHTML=`<div class="eyebrow">SLA risk · ${pname}</div>
    <h3 class="sc-title"><i style="background:${!checks.length?'var(--muted)':nMiss?'var(--bad)':nRisk?'var(--warn)':'var(--good)'}"></i>${head}</h3>
    <p class="sc-text">${nMiss&&nAt?detail:''}${vp}</p>
    <div class="sc-facts"><span><b>${sizing(S.hc).tot.contract}</b>FTE rostered</span><span><b>${pct(occ,0)}</b>occupancy</span><span><b>${S.shrink}%</b>shrinkage</span><span><b>${live.sick.size} / ${live.leave.size}</b>off sick / on leave today</span></div>`;
  $('#verdict').hidden=true;
  // one card per SLA metric, all built the same way
  const gauge=(v,t,lo,hi,lowerBetter)=>{const sc=x=>clamp((x-lo)/(hi-lo),0,1)*100,ok=lowerBetter?v<=t:v>=t;
    return `<div class="gauge" title="Expected ${pct(v,1)}, target ${pct(t,0)}"><i style="width:${sc(v)}%;background:${ok?'var(--good)':'var(--bad)'}"></i><b style="left:${sc(t)}%"></b></div>`};
  const kv=rows=>`<div class="kv">${rows.map(([k,v])=>`<span>${k}</span><b>${v}</b>`).join('')}</div>`;
  const cards=[];
  for(const c of CH){if(!E[c].on)continue;const x=r.exp.ch[c];
    const name={voice:`Calls answered in ${E.voice.slSec}s`,chat:`Chats answered in ${E.chat.slSec}s`,email:`Emails replied in ${E.email.slHrs}h`,ticket:`Tickets resolved in ${E.ticket.slHrs}h`}[c];
    if(x.off<=0){cards.push(`<div class="mcard"><div class="card-top"><h3><span class="sw ${c}"></span>${name}</h3>${pill(null)}</div></div>`);continue}
    const sl=x.sla/x.off,t=E[c].slPct/100,lo=Math.max(0,Math.min(sl,t)-0.2);
    const rows=[[`Offered ${pname}`,fmtN(x.off)]];
    if(c==='voice')rows.push(['Average wait',mss(x.asa/x.off)],[S.model==='A'?'Erlang C (no abandons)':'Erlang A (with abandons)',pct(x.slc/x.off)]);
    if(c==='chat')rows.push(['Average wait',mss(x.asa/x.off)],['Abandoned',S.model==='A'?pct(x.ab/x.off):'–']);
    if(DEFER.includes(c))rows.push([c==='email'?'Replied late':'Resolved late',fmtN(x.off-x.sla)],['Target clock',S.h24?'24 hours':'Opening hours']);
    cards.push(`<div class="mcard"><div class="card-top"><h3><span class="sw ${c}"></span>${name}</h3>${pill(r.P[c])}</div>
      <div class="val">${pct(sl)}</div><div class="tgt">Target ${E[c].slPct}%</div>${gauge(sl,t,lo,1,false)}${kv(rows)}</div>`);
    if(c==='voice'&&S.model==='A'){const ab=x.ab/x.off,lim=S.abTarget/100;
      cards.push(`<div class="mcard"><div class="card-top"><h3><span class="sw voice"></span>Abandoned calls</h3>${pill(r.P.ab)}</div>
        <div class="val">${pct(ab)}</div><div class="tgt">Limit ${S.abTarget}% of calls offered</div>${gauge(ab,lim,0,Math.max(lim*2,ab*1.15),true)}
        ${kv([[`Calls lost ${pname}`,fmtN(x.ab)],['Headroom',(lim-ab>=0?'+':'')+((lim-ab)*100).toFixed(1)+' pts'],['Caller patience',mss(S.ch.voice.pat)]])}</div>`)}}
  $('#cards').innerHTML=cards.join('');
  // lang table
  const langs=activeLangs();
  let th='<tr><th>Language</th>'+on.map(c=>`<th>${CHN[c]}</th>`).join('')+'</tr>';
  let tb=langs.map(l=>{const x=r.exp.lang[l.key];return `<tr><td>${l.name} <span style="color:var(--muted)">${Math.round(langFrac(l.key)*100)}%</span></td>`+on.map(c=>{const y=x&&x[c];if(!y||y.off<=0)return '<td>–</td>';const v=y.sla/y.off;return `<td class="${v>=E[c].slPct/100?'ok':'miss'}">${pct(v)}</td>`}).join('')+'</tr>'}).join('');
  $('#langTbl').innerHTML=`<h3>Service level by language</h3><p class="hint" style="margin-bottom:8px">Expected ${pname}, against each channel's target.</p><table>${th}${tb}</table>`;
  if(repPeriod==='day')chartDay();else if(repPeriod==='week')chartWeek(r);else chartMonth(r);
}
function svgEl(w,h,inner){return `<svg viewBox="0 0 ${w} ${h}" role="img">${inner}</svg>`}
function chartDay(){
  const W=760,H=250,pl=34,pr=8,pt=10,pb=46,teams=getTeams();
  const req=new Float64Array(48),sch=new Float64Array(48),pln=new Float64Array(48);
  const lsch=liveSched(),psch=plannedSched(live.dow);
  for(const t of teams){const q=teamReq(t,live.dow);for(let i=0;i<48;i++){req[i]+=q[i];sch[i]+=lsch[t.id][i];pln[i]+=psch[t.id][i]}}
  const mx=Math.max(4,...req,...sch,...pln)*1.1,x=i=>pl+(W-pl-pr)*i/48,y=v=>pt+(H-pt-pb)*(1-v/mx),ch=H-pb;
  let g='';const step=mx>40?10:mx>16?5:2;
  for(let v=0;v<=mx;v+=step)g+=`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${pl-6}" y="${y(v)+3.5}" text-anchor="end">${v}</text>`;
  for(let hh=0;hh<=24;hh+=3)g+=`<text class="ax" x="${x(hh*2)}" y="${ch+40}" text-anchor="middle">${String(hh%24).padStart(2,'0')}:00</text>`;
  const stepPath=(arr)=>{let d=`M${x(0)},${y(arr[0])}`;for(let i=0;i<48;i++){d+=`H${x(i+1)}`;if(i<47)d+=`V${y(arr[i+1])}`}return d};
  g+=`<path d="${stepPath(sch)}V${ch}H${x(0)}Z" fill="var(--accent)" opacity=".22"/><path d="${stepPath(sch)}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  if(live.sick.size||live.leave.size)g+=`<path d="${stepPath(pln)}" fill="none" stroke="var(--ink-2)" stroke-width="1.2" stroke-dasharray="2 3"/>`;
  g+=`<path d="${stepPath(req)}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 4"/>`;
  // SL strip
  const V=liveSum.iv.voice,C=liveSum.iv.chat,tv=S.ch.voice.slPct/100,tc=S.ch.chat.slPct/100;
  const strip=(arr,off,tg,yy,lab)=>{let s=`<text class="ax" x="${pl-6}" y="${yy+7}" text-anchor="end">${lab}</text>`;for(let i=0;i<48;i++){if(off[i]<=0.01){continue}const v=arr[i]/off[i],c=v>=tg?'var(--good)':v>=tg-0.1?'var(--warn)':'var(--bad)';s+=`<rect x="${x(i)+0.5}" y="${yy}" width="${x(1)-x(0)-1}" height="9" rx="1.5" fill="${c}"/>`}return s};
  if(S.ch.voice.on)g+=strip(V.sla,V.off,tv,ch+6,'SL');
  if(S.ch.chat.on)g+=strip(C.sla,C.off,tc,ch+18,'Chat');
  const nx=x(simMin()/30);g+=`<line x1="${nx}" x2="${nx}" y1="${pt}" y2="${ch+28}" stroke="var(--bad)" stroke-width="1.5"/><text class="lbl" x="${nx+4}" y="${pt+10}">now</text>`;
  g+=`<rect id="hit" x="${pl}" y="${pt}" width="${W-pl-pr}" height="${H-pt}" fill="transparent"/>`;
  $('#chart').innerHTML=`<h3>Agents on seat vs required, ${DOW[live.dow]}</h3><p class="sub"><span style="color:var(--accent)">■</span> Scheduled on seat &nbsp; <span style="font-family:var(--f-mono)">- -</span> Required for target (after shrinkage)${(live.sick.size||live.leave.size)?' &nbsp; <span style="font-family:var(--f-mono)">···</span> Planned before absence':''}. Strips show call and chat service level per half hour.</p>${svgEl(W,H,g)}<div class="tip" id="tip" hidden></div>`;
  const svg=$('#chart svg'),tip=$('#tip');
  svg.addEventListener('pointermove',e=>{const rc=svg.getBoundingClientRect(),px=(e.clientX-rc.left)*W/rc.width,i=Math.floor((px-pl)/((W-pl-pr)/48));if(i<0||i>47){tip.hidden=true;return}
    tip.hidden=false;tip.innerHTML=`${hhmm(i*30)}–${hhmm(i*30+30)}<br>Required ${req[i].toFixed(1)} · On seat ${sch[i]}<br>${S.ch.voice.on?`Calls ${Math.round(V.off[i])} · SL ${V.off[i]>0?pct(V.sla[i]/V.off[i],0):'–'}`:''}`;
    const cr=$('#chart').getBoundingClientRect();tip.style.left=clamp(e.clientX-cr.left+12,0,cr.width-190)+'px';tip.style.top=(e.clientY-cr.top-60)+'px'});
  svg.addEventListener('pointerleave',()=>tip.hidden=true);
}
function chartWeek(r){
  const E=S.ch,on=CH.filter(c=>E[c].on),W=760,rowH=78,H=on.length*rowH+24,pl=70,pr=8;let g='';
  const bw=(W-pl-pr)/7;
  on.forEach((c,ri)=>{const y0=ri*rowH+6,hh=rowH-26,tg=E[c].slPct/100,lo=Math.min(0.5,tg-0.2),yy=v=>y0+hh*(1-(clamp(v,lo,1)-lo)/(1-lo));
    g+=`<text class="lbl" x="0" y="${y0+12}">${CHN[c]}</text><text class="ax" x="0" y="${y0+26}">tgt ${E[c].slPct}%</text><text class="ax" x="${pl-6}" y="${yy(1)+4}" text-anchor="end">100%</text><text class="ax" x="${pl-6}" y="${yy(lo)}" text-anchor="end">${Math.round(lo*100)}%</text><line class="grid" x1="${pl}" x2="${W-pr}" y1="${yy(lo)}" y2="${yy(lo)}"/>`;
    r.exp.perDay.forEach((d,i)=>{const x=d[c];if(x.off<=0)return;const v=x.sla/x.off,bx=pl+i*bw+bw*0.2,top=yy(v);
      g+=`<rect x="${bx}" y="${top}" width="${bw*0.6}" height="${Math.max(1,yy(lo)-top)}" rx="3" fill="var(--ch-${c})"><title>${DOW[i]}: ${pct(v)}</title></rect>`;
      if(i===0||v<tg)g+=`<text class="ax" x="${bx+bw*0.3}" y="${top-4}" text-anchor="middle">${Math.round(v*100)}</text>`});
    g+=`<line x1="${pl}" x2="${W-pr}" y1="${yy(tg)}" y2="${yy(tg)}" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="5 4"/>`});
  for(let i=0;i<7;i++)g+=`<text class="ax" x="${pl+i*bw+bw/2}" y="${H-4}" text-anchor="middle">${DOW[i]}</text>`;
  $('#chart').innerHTML=`<h3>Expected service level by day</h3><p class="sub">Each day uses its own optimised rota. The dashed line is the target.</p>${svgEl(W,H,g)}`;
}
function chartMonth(r){
  const E=S.ch,on=CH.filter(c=>E[c].on&&r.samples[c].length),W=760,rowH=80,H=on.length*rowH+10,pl=70,pr=8;let g='';
  on.forEach((c,ri)=>{const sm=r.samples[c],tg=E[c].slPct/100,lo=Math.min(tg-0.1,Math.min(...sm)),hi=Math.max(tg+0.05,Math.max(...sm)),nb=30,bins=new Array(nb).fill(0);
    sm.forEach(v=>bins[clamp(Math.floor((v-lo)/(hi-lo)*nb),0,nb-1)]++);const mxb=Math.max(...bins),y0=ri*rowH+8,hh=rowH-30,bw=(W-pl-pr)/nb,xx=v=>pl+(v-lo)/(hi-lo)*(W-pl-pr);
    g+=`<text class="lbl" x="0" y="${y0+12}">${CHN[c]}</text><text class="ax" x="0" y="${y0+26}">${r.P[c]<0.01?'<1%':r.P[c]>0.99?'>99%':Math.round(r.P[c]*100)+'%'} hit</text>`;
    bins.forEach((b,i)=>{if(!b)return;const bx=pl+i*bw,bh=b/mxb*hh,mid=lo+(i+0.5)/nb*(hi-lo);g+=`<rect x="${bx+1}" y="${y0+hh-bh}" width="${bw-2}" height="${bh}" rx="2" fill="${mid>=tg?'var(--ch-'+c+')':'var(--muted)'}" opacity="${mid>=tg?1:0.55}"/>`});
    g+=`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y0+hh}" y2="${y0+hh}"/><line x1="${xx(tg)}" x2="${xx(tg)}" y1="${y0}" y2="${y0+hh+4}" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="4 3"/>
      <text class="ax" x="${pl}" y="${y0+hh+14}">${pct(lo,0)}</text><text class="ax" x="${W-pr}" y="${y0+hh+14}" text-anchor="end">${pct(hi,0)}</text><text class="ax" x="${xx(tg)}" y="${y0+hh+14}" text-anchor="middle">target</text>`});
  $('#chart').innerHTML=`<h3>Range of monthly outcomes</h3><p class="sub">500 simulated months with volumes varying around the forecast. Bars right of the target line are months that hit it.</p>${svgEl(W,H,g)}`;
}

/* ============ panels ============ */
function getP(p){return p.split('.').reduce((o,k)=>o[k],S)}
function setP(p,v){const ks=p.split('.'),l=ks.pop();ks.reduce((o,k)=>o[k],S)[l]=v}
function syncInputs(){
  $$('[data-k]').forEach(el=>{const v=getP(el.dataset.k),sc=+(el.dataset.scale||1);
    if(el.type==='checkbox')el.checked=!!v;else if(document.activeElement!==el)el.value=typeof v==='number'?+(v/sc).toFixed(2):v});
  $$('#periodSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===S.period));
  $$('#modeSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===S.mode));
  $$('.per').forEach(e=>e.textContent={day:'day',week:'week',month:'month'}[S.period]);
  const tot=CH.map(c=>S.ch[c].on?`${fmtN(weeklyVol(c)/7)} ${CHN[c].toLowerCase()}`:null).filter(Boolean).join(', ');
  $('#periodHint').textContent=`${S.period==='day'?'Per open day. ':''}That's about ${tot} on an average day.`;
  $('#hoursRow').style.display=S.h24?'none':'flex';
  $('#shortRow').style.display=S.slBasis==='short'?'flex':'none';
  $$('input[name="confMode"]').forEach(r=>r.checked=r.value===S.confMode);
  $('#confOut').innerHTML=S.confMode==='pct'?`Each ${confPeriodNow()==='week'?'week':'month'} must hit every target with <b>${pctAim()}</b> probability.`:`${confAimTxt().replace(/^./,c=>c.toUpperCase())} means each month must hit every target with <b>${pctAim()}</b> probability.`;
  $$('#modelSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===S.model));
  $('#modelTag').textContent='Erlang '+S.model;
  $('#modelHint').textContent=S.model==='A'?'Callers hang up when their patience runs out, which shortens the queue for everyone else. More realistic, and gives an abandon rate.':'Assumes nobody ever hangs up. More conservative, so it asks for more agents, and it is what many WFM tools and contracts quote. Patience and abandon settings are ignored.';
  for(const id of ['abT','vPat','cPat','slBasis','shortAb'])$('#'+id).disabled=S.model==='C';
  $('#basisHint').textContent={offered:'The strictest reading. Every caller who gives up counts against you.',short:'Common in contracts. Callers who hang up almost straight away are treated as not really waiting.',answered:'Flatters the number. When the queue is overloaded, callers who give up stop counting against you, so understaffing can still look on target. The abandon limit is the only safeguard.'}[S.slBasis];
  $('#shrinkOut').textContent=S.shrink+'%';
  $('#modeHint').textContent=S.mode==='blended'?'Each language team takes every channel. Calls get priority, then chats; emails and tickets fill the gaps.':'Each language has a separate team per channel. No sharing between channels.';
  $$('#openDays button').forEach((b,i)=>b.setAttribute('aria-pressed',S.openDays[i]));
  renderLangs();renderBars();
}
function renderLangs(){
  const box=$('#langRows');const others=S.langs.slice(1).filter(l=>l.on).reduce((a,l)=>a+(+l.share||0),0);
  box.innerHTML=S.langs.map((l,i)=>i===0?`<div class="lang-row"><span></span><input type="text" value="${l.name}" data-li="${i}" data-f="name" aria-label="Main language name"><span class="pct">${Math.max(0,100-others)}% (rest)</span></div>`
    :`<div class="lang-row"><input type="checkbox" ${l.on?'checked':''} data-li="${i}" data-f="on" aria-label="Use ${l.name}"><input type="text" value="${l.name}" data-li="${i}" data-f="name" aria-label="Language name" ${l.on?'':'disabled'}><span class="pct"><input type="number" min="0" max="90" value="${l.share}" data-li="${i}" data-f="share" style="width:60px" ${l.on?'':'disabled'} aria-label="${l.name} share">%</span></div>`).join('');
  $$('[data-li]',box).forEach(el=>el.addEventListener(el.type==='text'?'change':'input',()=>{const l=S.langs[+el.dataset.li],f=el.dataset.f;
    l[f]=f==='on'?el.checked:f==='share'?clamp(+el.value||0,0,90):el.value.trim()||l.name;
    if(f!=='share')renderLangs();else{const o=S.langs.slice(1).filter(x=>x.on).reduce((a,x)=>a+(+x.share||0),0);box.querySelector('.pct').textContent=Math.max(0,100-o)+'% (rest)'}
    changed('lang')}));
}
let curveCh='voice';
function barEditor(box,xbox,vals,labels,opts){
  box.innerHTML=vals.map((v,i)=>`<div class="b${opts.closed&&opts.closed(i)?' closed':''}" data-i="${i}"><i></i></div>`).join('')+'<div class="bars-readout"></div>';
  xbox.innerHTML=labels.map(l=>`<span>${l}</span>`).join('');
  const bars=$$('.b',box),ro=$('.bars-readout',box);
  const paint=()=>{const mx=Math.max(opts.max||0,...vals)*1.08||1,sum=vals.reduce((a,b)=>a+b,0);bars.forEach((b,i)=>b.firstChild.style.height=(vals[i]/mx*100)+'%');return {mx,sum}};
  let st=paint(),drag=false;
  const at=e=>{const rc=box.getBoundingClientRect(),i=clamp(Math.floor((e.clientX-rc.left-6)/((rc.width-12)/vals.length)),0,vals.length-1),v=clamp((rc.bottom-e.clientY)/(rc.height-8),0,1)*st.mx;return {i,v}};
  box.onpointerdown=e=>{drag=true;box.setPointerCapture(e.pointerId);st=paint();move(e)};
  const move=e=>{const {i,v}=at(e);if(drag){vals[i]=Math.max(0.05,v);paint();opts.onChange()}const sum=vals.reduce((a,b)=>a+b,0);ro.textContent=opts.readout(i,vals[i]/sum)};
  box.onpointermove=move;box.onpointerup=box.onpointercancel=()=>{drag=false;st=paint();opts.onDone&&opts.onDone()};
  box.onpointerleave=()=>{if(!drag)ro.textContent=''};
}
function renderBars(){
  barEditor($('#dowBars'),$('#dowX'),S.dayW,DOW,{closed:i=>!S.openDays[i],readout:(i,f)=>`${DOW[i]} ${pct(f,0)} of week`,onChange:()=>changed('dow',true),onDone:()=>changed('dow')});
  $$('#curveSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===curveCh));
  const cu=S.ch[curveCh].curve;
  barEditor($('#curveBars'),$('#curveX'),cu,cu.map((_,i)=>i%3===0?String(i).padStart(2,'0'):''),{closed:i=>!isOpenIv(i*2),readout:(i,f)=>`${String(i).padStart(2,'0')}:00 · ${pct(f,1)} of the day`,onChange:()=>changed('curve',true),onDone:()=>changed('curve')});
}
function renderSetup(){
  const teams=getTeams();
  const wdO=weekdayOpen(),weO=weekendOpen();
  const stp=(t,f,lab)=>{const v=Math.round(S.hc[t.id]?.[f]||0);return `<label>${lab}<span class="stepper"><button data-t="${t.id}" data-f="${f}" data-d="-1" aria-label="Fewer">−</button><input type="number" min="0" max="400" value="${v}" data-t="${t.id}" data-f="${f}" aria-label="${t.label} ${lab}"><button data-t="${t.id}" data-f="${f}" data-d="1" aria-label="More">+</button></span></label>`};
  $('#teamList').innerHTML=teams.map(t=>{const rec=REC[t.id]||{wd:0,we:0},h=S.hc[t.id]||{wd:0,we:0};
    const short=(wdO&&h.wd<rec.wd)||(weO&&h.we<rec.we);
    return `<div class="team" style="grid-template-columns:1fr"><b>${t.label}</b><div class="stp-row">${wdO?stp(t,'wd','Mon–Fri'):''}${weO?stp(t,'we','Sat–Sun'):''}</div>
    <div class="meta">${t.sub} · recommended ${[wdO?rec.wd+' on weekdays':'',weO?rec.we+' at weekends':''].filter(Boolean).join(', ')}${short?' <span style="color:var(--bad)">(short)</span>':''}${(()=>{const m=MINH[t.id]||{wd:0,we:0},lowW=wdO&&m.wd&&h.wd<m.wd,lowE=weO&&m.we&&h.we<m.we;return lowW||lowE?`<br><span style="color:var(--bad)">Below minimum cover: needs at least ${[lowW?m.wd+' on weekdays':'',lowE?m.we+' at weekends':''].filter(Boolean).join(' and ')} to keep ${minSeat()} on seat through leave and lunches.</span>`:''})()}</div></div>`}).join('');
  $$('#teamList button').forEach(b=>b.onclick=()=>{const h=S.hc[b.dataset.t];h[b.dataset.f]=Math.max(0,Math.round(h[b.dataset.f]||0)+(+b.dataset.d));changed('hc')});
  $$('#teamList input').forEach(el=>el.onchange=()=>{S.hc[el.dataset.t][el.dataset.f]=clamp(Math.round(+el.value||0),0,400);changed('hc')});
  const sz=sizing(S.hc);
  $('#fte').textContent=`${sz.tot.contract} FTE · ${pct(1-attend(),1)} of rostered days lost to leave and sickness`;
  $('#sickList').innerHTML=[...live.sick].map(k=>{const a=AG.get(k);return a?`<span class="chip">${a.p.name}<button data-k="${k}">Undo</button></span>`:''}).join('')||'<span class="hint">Nobody is off sick today.</span>';
  $('#sickList').insertAdjacentHTML('beforeend',`<span class="hint" style="flex-basis:100%">${live.leave.size} on annual leave today. Absence is rolled at random each day; Reset today rolls it again.</span>`);
  $$('#sickList button').forEach(b=>b.onclick=()=>{live.sick.delete(b.dataset.k);afterLiveChange()});
  $('#replanHint').textContent=live.replanned?'Remaining shifts have been replanned around today\'s absence.':'Replanning moves shifts that haven\'t started yet to cover the gap. Agents already on shift stay put.';
}

/* ============ shift schedule ============ */
let shDay=0,shTeam='all';
function openShifts(){shDay=live.dow;$('#scrim').hidden=false;$('#shifts').hidden=false;renderShifts();setTimeout(()=>$('#shClose').focus(),30)}
function closeShifts(){$('#shifts').hidden=true;if(!openDrawer)$('#scrim').hidden=true}
function segs(a,b){const out=[];a=((a%1440)+1440)%1440;b=a+(b-a);if(b<=1440)out.push([a,b]);else{out.push([a,1440]);out.push([0,b-1440])}return out}
function shiftGroups(d){
  const teams=getTeams().filter(t=>shTeam==='all'||t.id===shTeam),g=new Map();
  for(const t of teams)for(const st of (PLAN[d]?.[t.id]||[])){if(!g.has(st))g.set(st,{s:st,n:0,by:{}});const o=g.get(st);o.n++;o.by[t.label]=(o.by[t.label]||0)+1}
  return {teams,groups:[...g.values()].sort((a,b)=>shS(a.s)-shS(b.s)||a.s-b.s)};
}
function renderShifts(){
  if($('#shifts').hidden)return;
  const teams=getTeams();
  $('#shDay').innerHTML=DOW.map((n,i)=>`<button data-v="${i}" aria-pressed="${i===shDay}" ${S.openDays[i]?'':'disabled'}>${n}</button>`).join('');
  $$('#shDay button').forEach(b=>b.onclick=()=>{shDay=+b.dataset.v;renderShifts()});
  if(shTeam!=='all'&&!teams.find(t=>t.id===shTeam))shTeam='all';
  $('#shTeam').innerHTML=`<option value="all">All teams</option>`+teams.map(t=>`<option value="${t.id}" ${t.id===shTeam?'selected':''}>${t.label}</option>`).join('');
  const {teams:sel,groups}=shiftGroups(shDay),tot=groups.reduce((a,g)=>a+g.n,0);
  $('#shSub').textContent=`The optimal start times for ${DOW[shDay]}'s forecast with ${tot} agents on shift. Full-time shifts are 4 hours on, a 1-hour lunch, then 4 hours on${S.ptOn?`; part-time (PT) shifts are ${ptLen()/2} hours with no lunch`:''}.`;
  const req=new Float64Array(48),on=new Float64Array(48);
  for(const t of sel){const q=teamReq(t,shDay),c=coverage(PLAN[shDay]?.[t.id]||[]).on;for(let i=0;i<48;i++){req[i]+=q[i];on[i]+=c[i]}}
  const reqH=req.reduce((a,b)=>a+b,0)/2,onH=on.reduce((a,b)=>a+b,0)/2,under=req.reduce((a,r,i)=>a+Math.max(0,r-on[i]),0)/2;
  $('#shFacts').innerHTML=`<div class="fact"><b>${groups.length}</b><span>distinct start times</span></div>
    <div class="fact"><b>${tot}</b><span>shifts</span></div>
    <div class="fact"><b>${groups.length?hhmm(Math.min(...groups.map(g=>shS(g.s)))*30)+' – '+hhmm(Math.max(...groups.map(g=>shS(g.s)))*30):'–'}</b><span>first and last start</span></div>
    <div class="fact"><b>${onH?pct(reqH/onH,0):'–'}</b><span>of on-seat hours needed for target</span></div>
    <div class="fact"><b>${under.toFixed(1)}h</b><span>short of requirement across the day</span></div>`;
  const W=940,pl=150,pr=10,top=22,rh=22,H=top+Math.max(1,groups.length)*rh+6,x=m=>pl+(W-pl-pr)*m/1440,mxN=Math.max(1,...groups.map(z=>z.n));let g='';
  for(let h=0;h<=24;h+=2)g+=`<line class="grid" x1="${x(h*60)}" x2="${x(h*60)}" y1="${top-4}" y2="${H}"/><text class="ax" x="${x(h*60)}" y="12" text-anchor="middle">${String(h%24).padStart(2,'0')}:00</text>`;
  groups.forEach((o,r)=>{const y=top+r*rh+3,s0=shS(o.s)*30,pt=shPT(o.s),bh=rh-7,br=Object.entries(o.by).map(([k,v])=>`${k} ${v}`).join(', ');
    g+=`<g><title>${pt?'Part-time '+shLabel(o.s):`${hhmm(s0)}–${hhmm(s0+540)}, lunch ${hhmm(s0+240)}–${hhmm(s0+300)}`}: ${o.n} agent${o.n>1?'s':''}${sel.length>1?' ('+br+')':''}</title>`;
    g+=`<rect x="0" y="${y-2}" width="${W}" height="${rh-2}" fill="transparent"/>`;
    g+=`<text class="lbl" x="0" y="${y+bh-3}">${shLabel(o.s)}${pt?' PT':''}</text><text class="ax" x="${pl-8}" y="${y+bh-3}" text-anchor="end" style="font-weight:600">×${o.n}</text>`;
    for(const [a,b,lun] of shSegs(o.s))for(const [p,q] of segs(a,b))
      g+=`<rect x="${x(p)+(lun?0:1)}" y="${y}" width="${Math.max(1,x(q)-x(p)-(lun?0:2))}" height="${bh}" rx="${lun?0:3}" fill="${lun?'var(--muted)':'var(--accent)'}" opacity="${lun?0.35:0.35+0.65*o.n/mxN}"/>`;
    g+='</g>'});
  if(!groups.length)g+=`<text class="lbl" x="${pl}" y="${top+14}">No shifts on this day.</text>`;
  $('#shGantt').innerHTML=`<h3>Shifts by start time</h3><p class="sub"><span style="color:var(--accent)">■</span> On shift, darker where more agents start together &nbsp; <span style="color:var(--muted)">■</span> Lunch. Hover a row for the team split.</p><div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" style="min-width:640px">${g}</svg></div>`;
  const CH2=200,pb=24,pt=8,mx=Math.max(3,...req,...on)*1.1,yy=v=>pt+(CH2-pt-pb)*(1-v/mx),xx=i=>pl+(W-pl-pr)*i/48;let c='';
  const step=mx>40?10:mx>16?5:2;for(let v=0;v<=mx;v+=step)c+=`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${yy(v)}" y2="${yy(v)}"/><text class="ax" x="${pl-6}" y="${yy(v)+3.5}" text-anchor="end">${v}</text>`;
  for(let h=0;h<=24;h+=2)c+=`<text class="ax" x="${xx(h*2)}" y="${CH2-6}" text-anchor="middle">${String(h%24).padStart(2,'0')}:00</text>`;
  const sp=a=>{let d=`M${xx(0)},${yy(a[0])}`;for(let i=0;i<48;i++){d+=`H${xx(i+1)}`;if(i<47)d+=`V${yy(a[i+1])}`}return d};
  c+=`<path d="${sp(on)}V${yy(0)}H${xx(0)}Z" fill="var(--accent)" opacity=".2"/><path d="${sp(on)}" fill="none" stroke="var(--accent)" stroke-width="2"/><path d="${sp(req)}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 4"/>`;
  for(let i=0;i<48;i++)if(req[i]-on[i]>0.5)c+=`<rect x="${xx(i)}" y="${yy(req[i])}" width="${xx(1)-xx(0)}" height="${yy(on[i])-yy(req[i])}" fill="var(--bad)" opacity=".3"/>`;
  $('#shCov').innerHTML=`<h3>Cover against requirement</h3><p class="sub"><span style="color:var(--accent)">■</span> Agents on seat &nbsp; <span style="font-family:var(--f-mono)">- -</span> Needed for target, after ${S.shrink}% shrinkage &nbsp; <span style="color:var(--bad)">■</span> Shortfall</p><div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${CH2}" style="min-width:640px">${c}</svg></div>`;
}
$('#openShifts').onclick=openShifts;$('#shClose').onclick=closeShifts;
$('#shTeam').onchange=e=>{shTeam=e.target.value;renderShifts()};
$('#shCopy').onclick=async()=>{
  const rows=[['Day','Team','Type','Start','End','Lunch start','Lunch end','Agents']];
  for(const t of getTeams().filter(t=>shTeam==='all'||t.id===shTeam)){const m=new Map();for(const st of PLAN[shDay]?.[t.id]||[])m.set(st,(m.get(st)||0)+1);
    for(const [st,n] of [...m].sort((a,b)=>a[0]-b[0])){const s0=shS(st)*30,pt=shPT(st);rows.push([DOW[shDay],t.label,pt?'Part-time':'Full-time',hhmm(s0),hhmm(s0+shMins(st)),pt?'':hhmm(s0+240),pt?'':hhmm(s0+300),n])}}
  const txt=rows.map(r=>r.join(',')).join(String.fromCharCode(10)),b=$('#shCopy');
  try{await navigator.clipboard.writeText(txt);b.textContent='Copied'}catch(e){b.textContent='Copy failed'}
  setTimeout(()=>b.textContent='Copy as CSV',1600)};

/* ============ saved scenarios ============ */
// Scenarios travel in the link: #cfg-<z|r><base64 of deflated JSON>, with + and / escaped as -a and -b
// (the artifact link only carries letters, digits and hyphens in its fragment).
let SC={list:[],curId:null,saved:null,confirmDel:null,lastHash:''};
const snapshotS=()=>JSON.stringify(S);
function scDirty(){return SC.saved!==snapshotS()}
function syncScenarioBar(){
  if(document.activeElement!==$('#scName'))$('#scName').value=S.name||'';
  $('#scSave').textContent=SC.curId?(scDirty()?'Save changes':'Saved'):'Save';
  $('#scSave').disabled=!!SC.curId&&!scDirty();
}
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
  needRec=true;syncInputs();recompute();SC.saved=snapshotS();syncScenarioBar();
}
async function openFromHash(){
  const h=location.hash;if(!h||h===SC.lastHash||!/^#cfg-/.test(h))return;
  SC.lastHash=h;
  try{const cfg=await decodeConfig(h);if(!cfg||!cfg.ch)throw 0;SC.curId=null;applyConfig(cfg);flash(`Opened shared scenario “${S.name||'Untitled'}”`)}
  catch(e){flash('That link doesn’t contain a scenario this page can read.',true)}
}
async function shareLink(){
  const h=await encodeConfig(S);SC.lastHash='#'+h;location.hash=h;
  const href=location.href;
  if(/^https:\/\/claude\.ai\//.test(href)){try{await navigator.clipboard.writeText(href);flash('Link copied. Anyone with access to this page can open the scenario.');return}catch(e){}}
  flash('Link updated. Copy it from the address bar, or use Share then Copy link.');
}
function saveScenario(asNew){
  const name=(S.name||'').trim()||'Untitled scenario';S.name=name;
  const id=(!asNew&&SC.curId)||('s'+Date.now().toString(36)+Math.random().toString(36).slice(2,6));
  const l=localList().filter(x=>x.id!==id);
  l.unshift({id,name,config:snapshotS(),fte:sizing(REC).tot.contract,model:S.model,savedAt:Date.now()});
  if(!localWrite(l)){flash('This browser won’t let the page save. Use Share link instead.',true);return}
  SC.list=l;SC.curId=id;SC.saved=snapshotS();save();flash(`Saved “${name}” in this browser`);
  syncScenarioBar();renderScenarios();
}
function loadScenario(id){
  const sc=SC.list.find(x=>x.id===id);if(!sc)return;
  let cfg;try{cfg=JSON.parse(sc.config)}catch(e){flash('That scenario couldn’t be read.',true);return}
  SC.curId=id;applyConfig(cfg,sc.name);$('#scPanel').hidden=true;flash(`Opened “${sc.name}”`);
}
function deleteScenario(id){
  SC.list=localList().filter(x=>x.id!==id);localWrite(SC.list);
  if(SC.curId===id){SC.curId=null;SC.saved=null}
  SC.confirmDel=null;syncScenarioBar();renderScenarios();
}
function renderScenarios(){
  const p=$('#scPanel');if(p.hidden)return;SC.list=localList();
  p.innerHTML=`<div class="sc-head"><b>Saved scenarios</b><button class="btn" id="scNew">Save as new</button></div>
    <p class="hint">Saved in this browser. To send one to someone else, open it and choose Share link.</p>
    ${SC.list.length?`<ul class="sc-list">${SC.list.map(x=>`<li class="${x.id===SC.curId?'cur':''}"><button class="sc-open" data-id="${x.id}"><b></b><span class="meta"></span></button>
      ${SC.confirmDel===x.id?`<button class="btn danger" data-del="${x.id}">Confirm delete</button>`:`<button class="x" data-ask="${x.id}" aria-label="Delete">×</button>`}</li>`).join('')}</ul>`
      :'<p class="hint">Nothing saved yet. Name this scenario in the top bar and choose Save.</p>'}`;
  $$('.sc-open',p).forEach((b,i)=>{const x=SC.list[i];b.querySelector('b').textContent=x.name;
    b.querySelector('.meta').textContent=`${x.fte} FTE · ${x.model==='C'?'Erlang C':'Erlang A'} · ${new Date(x.savedAt).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}`;
    b.onclick=()=>loadScenario(x.id)});
  $$('[data-ask]',p).forEach(b=>b.onclick=e=>{e.stopPropagation();SC.confirmDel=b.dataset.ask;renderScenarios()});
  $$('[data-del]',p).forEach(b=>b.onclick=e=>{e.stopPropagation();deleteScenario(b.dataset.del)});
  $('#scNew').onclick=()=>saveScenario(true);
}
function initScenarios(){SC.list=localList();openFromHash()}
let flashT=0;function flash(msg,bad){const t=$('#toast');t.textContent=msg;t.classList.toggle('bad',!!bad);t.hidden=false;clearTimeout(flashT);flashT=setTimeout(()=>t.hidden=true,3200)}
$('#scSave').onclick=()=>saveScenario(false);
$('#scShare').onclick=()=>shareLink();
// Reset: every setting back to its default. Asks for a second click; saved scenarios are untouched.
let resetT=0;
$('#scReset').onclick=()=>{const b=$('#scReset');
  if(!b.classList.contains('danger')){b.classList.add('danger');b.textContent='Confirm reset';clearTimeout(resetT);resetT=setTimeout(()=>{b.classList.remove('danger');b.textContent='Reset'},4000);return}
  clearTimeout(resetT);b.classList.remove('danger');b.textContent='Reset';
  SC.curId=null;SC.lastHash='';if(location.hash)location.hash='';
  CAM={z:1,x:0,y:0};closePop();setDrawer(null);closeShifts();
  simReset=true;applyConfig(structuredClone(DEFAULT));
  flash('Everything is back to the default settings. Saved scenarios are still under Saved.')};
$('#scOpen').onclick=e=>{e.stopPropagation();const p=$('#scPanel');p.hidden=!p.hidden;SC.confirmDel=null;renderScenarios()};
document.addEventListener('click',e=>{const p=$('#scPanel');if(!p.hidden&&!p.contains(e.target)&&e.target!==$('#scOpen'))p.hidden=true});
$('#scName').addEventListener('input',e=>{S.name=e.target.value;save();syncScenarioBar()});
window.addEventListener('hashchange',openFromHash);

/* ============ splash ============ */
function spTab(v){$$('#spTabs button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===v));$('#spStart').hidden=v!=='start';$('#spHow').hidden=v!=='how'}
$$('#spTabs button').forEach(b=>b.onclick=()=>spTab(b.dataset.v));
function openSplash(){$('#scrim').hidden=false;$('#splash').hidden=false;setTimeout(()=>$('#spGo').focus(),30)}
function closeSplash(){if($('#splash').hidden)return;$('#splash').hidden=true;if(!openDrawer&&$('#shifts').hidden)$('#scrim').hidden=true;
  if($('#spHide').checked){try{localStorage.setItem('copenhagen.splash','off')}catch(e){}}}
$('#openHelp').onclick=openSplash;$('#spGo').onclick=closeSplash;$('#spClose').onclick=closeSplash;
(()=>{let off=false;try{off=localStorage.getItem('copenhagen.splash')==='off'}catch(e){}if(!off)openSplash()})();


/* ============ change pipeline ============ */
let tChange=0,tMC=0,needRec=true,rerollAbsence=false;
function changed(what,light){
  if(what==='alDays'||what==='sickDays')rerollAbsence=true;
  if(what!=='name')simReset=true;
  if(what==='hc')S.autoSize=false;else if(!['autoSize','fcErr','name'].includes(what))needRec=true;
  save();setTimeout(syncScenarioBar,0);clearTimeout(tChange);tChange=setTimeout(()=>recompute(),light?220:60);
  if(what!=='lang'&&what!=='curve'&&what!=='dow')syncInputs();
}

/* ---- confidence sizing: the worker finds the smallest roster that meets the contract aim ---- */
let CONF={busy:false,p:null,f:1,gen:0};
const worstP=P=>M.worstP(C(),P), scaleRec=(base,f)=>M.scaleRec(C(),base,MINH,f);
function confAimTxt(){const N=Math.round(+S.contractMonths||84),k=+S.missesAllowed||0;
  if(S.confMode==='misses')return `at most ${k} missed month${k===1?'':'s'} in ${N}`;
  if(S.confMode==='clean')return `${S.cleanChance}% chance of no missed month in ${N}`;
  return `${S.conf}% of ${S.confPeriod==='week'?'weeks':'months'}`}
const pctAim=()=>(confTarget()*100).toFixed(confTarget()>0.999?2:1)+'%';
function startConf(){
  const g=++CONF.gen;CONF.busy=true;CONF.p=null;renderSizing();
  sim({type:'conf',S,rec0:REC0,minh:MINH}).then(r=>{
    if(g!==CONF.gen)return;
    CONF.busy=false;CONF.p=r.p;CONF.f=r.f;REC=r.hc;
    for(const t of getTeams())if(S.autoSize||!S.hc[t.id])S.hc[t.id]={...(REC[t.id]||{wd:0,we:0})};
    computePlans();doSimReset();evalLive();buildMTD();buildLayout();renderSetup();renderSizing();renderShifts();scheduleMC();save()});
}
function recompute(){
  freshCtx();
  const teams=getTeams();
  if(needRec){const r=M.computeRec(C());REC0=r.rec;MINH=r.minh;REC_WARN=new Set(r.warn);
    REC=S.confOn&&CONF.f?scaleRec(REC0,CONF.f):REC0;needRec=false;startTrade();
    if(S.confOn)startConf();else{CONF.gen++;CONF.busy=false;CONF.p=null;CONF.f=1}}
  for(const t of teams)if(S.autoSize||!S.hc[t.id]||typeof S.hc[t.id]!=='object')S.hc[t.id]={...(REC[t.id]||{wd:0,we:0})};
  EV=new Map();computePlans();if(simReset){simReset=false;doSimReset()}else resetLive(!rerollAbsence);rerollAbsence=false;evalLive();buildMTD();buildLayout();renderSetup();renderSizing();renderShifts();scheduleMC();save();
}
function afterLiveChange(){evalLive();renderSetup();scheduleMC(true);renderReportSoon()}
/** Today's odds are worked out here; the week and month ones come back from the worker. */
let mcGen=0;
function requestMC(period){const g=mcGen;
  sim({type:'mc',S,hc:S.hc,period}).then(r=>{if(g!==mcGen)return;MC[period]=r;renderReport()})}
function scheduleMC(onlyDay){clearTimeout(tMC);if(!onlyDay)mcGen++;MC=onlyDay?{...MC,day:null}:{};renderReport();
  tMC=setTimeout(()=>{MC.day=runMC('day');if(repPeriod!=='day'&&!MC[repPeriod])requestMC(repPeriod);updateTicker();renderReport()},120)}
let tRep=0;function renderReportSoon(){clearTimeout(tRep);tRep=setTimeout(renderReport,50)}


/* ============ wiring ============ */
$('#daySel').innerHTML=DOW.map((d,i)=>`<option value="${i}">${d}</option>`).join('');
['openFrom','openTo'].forEach(id=>$('#'+id).innerHTML=[...Array(25).keys()].map(h=>`<option value="${h}">${String(h).padStart(2,'0')}:00</option>`).join(''));
$('#openDays').innerHTML=DOW.map((d,i)=>`<button data-i="${i}">${d}</button>`).join('');
$$('#openDays button').forEach(b=>b.onclick=()=>{S.openDays[+b.dataset.i]=!S.openDays[+b.dataset.i];changed('open')});
$$('[data-k]').forEach(el=>{
  const ev=el.tagName==='SELECT'||el.type==='checkbox'?'change':'input';
  el.addEventListener(ev,()=>{const sc=+(el.dataset.scale||1);let v;
    if(el.type==='checkbox')v=el.checked;else if(el.dataset.str!=null)v=el.value;else{v=+el.value*sc;if(!isFinite(v)||el.value==='')return;
      // only number and range inputs carry min/max; a select has neither, and +undefined would turn the value into NaN
      if(el.min)v=Math.max(+el.min*sc,v);if(el.max)v=Math.min(+el.max*sc,v);if(!isFinite(v))return}
    if(/^ch\.(chat|email|ticket)\.conc$/.test(el.dataset.k))v=Math.round(v);
    setP(el.dataset.k,v);
    if(!S.h24&&S.openTo%24===S.openFrom%24){S.openTo=(S.openFrom+1)%24||24}
    changed(el.dataset.k,el.type==='range')});
});
$$('#periodSeg button').forEach(b=>b.onclick=()=>{
  const f={day:openDayCount(),week:1,month:7/30.44},from=f[S.period],to=f[b.dataset.v];
  for(const c of CH)S.ch[c].vol=Math.round(S.ch[c].vol*from/to);S.period=b.dataset.v;changed('period')});
$$('input[name="confMode"]').forEach(r=>r.onchange=()=>{if(r.checked){S.confMode=r.value;S.confOn=true;changed('confMode')}});
$$('#modelSeg button').forEach(b=>b.onclick=()=>{if(S.model===b.dataset.v)return;S.model=b.dataset.v;changed('model')});
$$('#modeSeg button').forEach(b=>b.onclick=()=>{if(S.mode===b.dataset.v)return;S.mode=b.dataset.v;S.hc={};changed('mode')});
$$('#curveSeg button').forEach(b=>b.onclick=()=>{curveCh=b.dataset.v;renderBars()});
$('#presetSel').onchange=e=>{const v=e.target.value;if(!v)return;S.ch[curveCh].curve=PRESET[v].slice();e.target.value='';renderBars();changed('curve')};
$('#useRec').onclick=()=>{S.autoSize=true;changed('autoSize')};
$('#sickBtn').onclick=()=>{
  const m=simMin(),pool=[...AG.values()].filter(a=>!live.sick.has(a.key)&&!['off','rest','leave'].includes(planState(a,m)));
  const pool2=pool.length?pool:[...AG.values()].filter(a=>!['rest','leave','sick'].includes(planState(a,simMin())));
  if(!pool2.length)return;const a=pool2[Math.floor(Math.random()*pool2.length)];live.sick.add(a.key);afterLiveChange()};
$('#replanBtn').onclick=()=>{replan();afterLiveChange()};
$('#resetDay').onclick=()=>{resetLive(false);afterLiveChange();teleportAll()};
$('#daySel').onchange=e=>{live.dow=+e.target.value;EV=new Map();resetLive(false);evalLive();buildMTD();teleportAll();renderSetup();scheduleMC()};
$('#scrub').addEventListener('input',e=>{simSec=+e.target.value*60;teleportAll();wbState.next=0});
$('#playBtn').onclick=()=>{playing=!playing;syncPlay()};
$('#incBtn').onclick=()=>{const i=Math.floor(simMin()/30);
  if(incidentOn()){if(live.incident.to<48)live.incident.to=48;else live.incident.to=i+1}else live.incident={from:i,to:48};
  syncInc();afterLiveChange();wbState.next=0};
function syncInc(){const on=incidentOn(),ending=on&&live.incident.to<48,b=$('#incBtn');
  b.setAttribute('aria-pressed',on);b.classList.toggle('ending',ending);
  b.textContent=ending?`Ends at ${hhmm(live.incident.to*30)}`:on?'End incident':'Major incident';
  b.title=ending?'Winding down at the end of this half hour. Click to keep the incident running.':on?'Stop the incident at the end of the current half hour':'Double call volume from now'}
function syncPlay(){$('#playBtn').textContent=playing?'Pause':'Play';$('#playBtn').setAttribute('aria-label',playing?'Pause':'Play')}
$$('#speedSeg button').forEach(b=>b.onclick=()=>{speed=+b.dataset.v;$$('#speedSeg button').forEach(x=>x.setAttribute('aria-pressed',x===b))});
$$('#repSeg button').forEach(b=>b.onclick=()=>{repPeriod=b.dataset.v;$$('#repSeg button').forEach(x=>x.setAttribute('aria-pressed',x===b));
  if(!MC[repPeriod]){renderReport();if(repPeriod==='day')setTimeout(()=>{MC.day=runMC('day');renderReport()},30);else requestMC(repPeriod)}else renderReport()});
// drawers
let openDrawer=null;
function setDrawer(id){openDrawer=id;$$('.drawer').forEach(d=>{const o=d.id===id;d.classList.toggle('open',o);d.setAttribute('aria-hidden',!o)});$('#scrim').hidden=!id;if(id)setTimeout(()=>$('#'+id+' .x').focus(),50)}
$$('[data-open]').forEach(b=>b.onclick=()=>setDrawer(b.dataset.open));
$$('[data-close]').forEach(b=>b.onclick=()=>setDrawer(null));
$('#scrim').onclick=()=>{setDrawer(null);closeShifts();closeSplash()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){setDrawer(null);closePop();closeShifts();closeSplash()}});

/* ============ boot ============ */
$$('#speedSeg button').forEach(x=>x.setAttribute('aria-pressed',+x.dataset.v===speed));
$$('#repSeg button').forEach(x=>x.setAttribute('aria-pressed',x.dataset.v===repPeriod));
syncPlay();syncInputs();
{const r=M.computeRec(C());REC0=r.rec;MINH=r.minh;REC_WARN=new Set(r.warn);REC=REC0;needRec=false;}
for(const t of getTeams())if(S.autoSize||!S.hc[t.id]||typeof S.hc[t.id]!=='object')S.hc[t.id]={...(REC[t.id]||{wd:0,we:0})};
computePlans();resetLive(false);evalLive();buildMTD();buildLayout();renderSetup();renderSizing();scheduleMC();startTrade();if(S.confOn)startConf();
syncScenarioBar();initScenarios();
let lastDraw=0,last=performance.now(),lastWb=0,lastScrub=0;
function frame(now){
  const dt=Math.min(0.1,(now-last)/1000);last=now;
  if(playing)advance(dt*speed);
  updateAgents(dt);if(now-lastDraw>=31){lastDraw=now;drawScene(now/1000)}
  if(now-lastWb>400){lastWb=now;syncInc();renderWallboard(now/1000);$('#clockOut').textContent=hhmm(simMin());}
  if(now-lastScrub>250&&document.activeElement!==$('#scrub')){lastScrub=now;$('#scrub').value=Math.floor(simMin())}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
