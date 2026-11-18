// The floor: an isometric room drawn on a canvas, with agents who walk to their desks, take breaks and work contacts.
// It reads the live day from the engine and draws it; clicking an agent opens the popover (ui.pop).
import { clamp, lerp, mulberry, hashStr } from '../model';
import { S, live, liveRes, simMin, simSec, ui, getTeams, deskCount, shS, shKind, shMins, shDesc, incidentOn } from './engine.svelte.js';
import { hhmm } from './format.js';

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
export let AG=new Map(); // key -> visual agent
const P=(gx,gy,z=0)=>[L.OX+(gx-gy)*TW/2,L.OY+(gx+gy)*TH/2-z];
export function buildLayout(){
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
export function planState(a,m){
  if(live.leave.has(a.key))return 'leave';
  if(live.sick.has(a.key))return 'sick';
  const x=agentStart(a);if(x==null)return 'rest';
  const off=((m-shS(x)*30)%1440+1440)%1440;
  if(shKind(x))return off<shMins(x)?'work':'off';
  return off<240?'work':off<300?'lunch':off<540?'work':'off';
}
function pathFor(a,inward,door){const d=L.doors[door],s=a.desk.seat,cx=0.85,ay=a.desk.aisle;
  const pts=[{x:d.gx,y:d.gy},{x:cx,y:d.gy},{x:cx,y:ay},{x:s.x,y:ay},{x:s.x,y:s.y}];return inward?pts:pts.reverse()}
function startWalk(a,inward,door){a.walk={pts:pathFor(a,inward,door),seg:0,t:0,inward,door};a.loc='walk'}
export function teleportAll(){const m=simMin();for(const a of AG.values()){const st=planState(a,m);a.walk=null;a.breakUntil=-1;a.loc=st==='work'?'seated':'away';a.actUntil=0}}
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
export function updateAgents(dt){
  const m=simMin(),simS=simSec,speed=ui.speed,wsp=2.6*clamp(speed/120,1,5);
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
      if(st==='work'&&!onBreak){const x=agentStart(a),off=((m-shS(x)*30)%1440+1440)%1440,len=shMins(x),edge=off<20||off>len-25||(!shKind(x)&&off>220&&off<320);
        if(!edge&&Math.random()<dt*speed/60/160)a.breakUntil=m+4+Math.random()*6}
      if(simS>=a.actUntil||a.actUntil-simS>4000)chooseAct(a,simS);
    }
  }
}

/* ============ floor drawing ============ */
let cv=null,floorEl=null,ctxMain=null,ctx=null,bgKey='',layoutVer=0;const bgCv=document.createElement('canvas');
let CAM={z:1,x:0,y:0};
function resize(){if(!cv)return;const w=cv.clientWidth||floorEl.clientWidth,dpr=Math.min(2,window.devicePixelRatio||1);
  cv.width=Math.round(w*dpr);cv.height=Math.round(w*L.LH/L.LW*dpr);cv.style.height=(w*L.LH/L.LW)+'px';clampCam()}
function clampCam(){CAM.z=clamp(CAM.z,1,5);const vw=L.LW/CAM.z,vh=L.LH/CAM.z;CAM.x=clamp(CAM.x,0,L.LW-vw);CAM.y=clamp(CAM.y,0,L.LH-vh);
  ui.zoomed=CAM.z>1.01;if(cv){cv.style.touchAction=CAM.z>1.01?'none':'pan-y';cv.style.cursor=CAM.z>1.01?'grab':'pointer'}}
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
export function drawScene(t){
  if(!cv)return;
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
/** Attach the floor to its canvas. Returns a function that detaches it. */
export function attachFloor(canvas,el){
  cv=canvas;floorEl=el;ctxMain=ctx=cv.getContext('2d');
  const offs=[],on=(t,f,o)=>{cv.addEventListener(t,f,o);offs.push(()=>cv.removeEventListener(t,f,o))};
  const onResize=()=>resize();window.addEventListener('resize',onResize);offs.push(()=>window.removeEventListener('resize',onResize));
  on('pointerdown',e=>{const rc=cv.getBoundingClientRect();PTR.set(e.pointerId,[e.clientX-rc.left,e.clientY-rc.top]);
  if(PTR.size===1){downAt={x:e.clientX,y:e.clientY,cx:CAM.x,cy:CAM.y,moved:false};if(CAM.z>1.01)cv.setPointerCapture(e.pointerId)}
  if(PTR.size===2){const [a,b]=[...PTR.values()];pinch0={d:Math.hypot(a[0]-b[0],a[1]-b[1]),z:CAM.z};downAt&&(downAt.moved=true)}});
  on('pointermove',e=>{if(!PTR.has(e.pointerId))return;const rc=cv.getBoundingClientRect();PTR.set(e.pointerId,[e.clientX-rc.left,e.clientY-rc.top]);
  if(PTR.size===2&&pinch0){const [a,b]=[...PTR.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);zoomAt(pinch0.z*d/pinch0.d/CAM.z,(a[0]+b[0])/2,(a[1]+b[1])/2);return}
  if(!downAt)return;const dx=e.clientX-downAt.x,dy=e.clientY-downAt.y;if(Math.hypot(dx,dy)>5)downAt.moved=true;
  if(downAt.moved&&CAM.z>1.01){const s2=L.LW/rc.width/CAM.z;CAM.x=downAt.cx-dx*s2;CAM.y=downAt.cy-dy*s2;clampCam();cv.style.cursor='grabbing';closePop()}});
const endPtr=e=>{const was=downAt;PTR.delete(e.pointerId);if(PTR.size<2)pinch0=null;if(PTR.size)return;downAt=null;clampCam();
  if(e.type==='pointerup'&&was&&!was.moved){const rc=cv.getBoundingClientRect(),cx=e.clientX-rc.left,cy=e.clientY-rc.top,best=pickDesk(cx,cy);
    if(!best){closePop();return}selectedKey=best.key;showPop(best,cx,cy)}};
  on('pointerup',endPtr);  on('pointercancel',endPtr);
  on('wheel',e=>{if(!(e.ctrlKey||e.metaKey))return;e.preventDefault();const rc=cv.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*0.01),e.clientX-rc.left,e.clientY-rc.top);closePop()},{passive:false});
  on('dblclick',e=>{const rc=cv.getBoundingClientRect();zoomAt(CAM.z>=4?1/CAM.z:2,e.clientX-rc.left,e.clientY-rc.top);closePop()});
  resize();teleportAll();
  return ()=>{offs.forEach(f=>f());cv=null;ctx=ctxMain=null};
}
export function zoomIn(){if(!cv)return;zoomAt(1.6,cv.clientWidth/2,cv.clientHeight/2);closePop()}
export function zoomOut(){if(!cv)return;zoomAt(1/1.6,cv.clientWidth/2,cv.clientHeight/2);closePop()}
export function resetCam(){CAM={z:1,x:0,y:0};clampCam();closePop()}
function showPop(d,px,py){
  const a=AG.get(d.key),st=planState(a,simMin()),x0=agentStart(a),s0=x0==null?0:shS(x0)*30;
  const desc={work:a.loc==='seated'?({voice:'On a call',chat:'Handling chats',email:'Working on emails',ticket:'Working on self-service tickets',idle:'Ready for the next contact'}[a.act]):(a.breakUntil>simMin()?'On a short break':'Walking to their desk'),lunch:'On lunch',off:'Not on shift right now',sick:'Off sick today',leave:'On annual leave today',rest:'Rest day (works 5 days in 7)'}[st];
  const shift=st==='rest'?'Not rostered today':(st==='sick'||st==='leave')?'Shift uncovered':shDesc(x0);
  ui.pop={key:a.key,name:a.p.name,team:a.team.label,desc,shift,st,left:clamp(px+12,8,floorEl.clientWidth-240),top:clamp(py-20,8,floorEl.clientHeight-150)};
}
export function closePop(){ui.pop=null;selectedKey=null}

