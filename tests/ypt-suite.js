// Fake YPT server whose group/day views lag the real state by STALE ms (like the real server)
const {chromium}=require('playwright');
const STALE=6000, LATENCY=400;
function makeServer(){
  const S={hist:[{t:0,on:false,st:null,sm:600000}],starts:0,stops:0};
  S.now=()=>Date.now();
  S.cur=()=>S.hist[S.hist.length-1];
  S.view=()=>{const t=Date.now()-STALE;let v=S.hist[0];for(const h of S.hist)if(h.t<=t)v=h;return S.glitch?{...v,on:false,st:null}:v};
  S.start=()=>{const c=S.cur();if(c.on)S.stopNow();S.hist.push({t:Date.now(),on:true,st:Date.now(),sm:S.cur().sm,sp:S.cur().sp});S.starts++};
  S.stopNow=()=>{const c=S.cur();if(!c.on)return;S.hist.push({t:Date.now(),on:false,st:null,sm:c.sm+(Date.now()-c.st),sp:Date.now()})};
  S.stop=()=>{S.stops++;if(!S.ignoreStop)S.stopNow()};
  return S;
}
async function setup(b,S,{localRun}={}){
  const c=await b.newContext();const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await c.route(/gstatic|googleapis|accounts\.google|jsdelivr/,r=>r.abort());
  await c.route(/workers\.dev/,async r=>{const u=r.request().url();await new Promise(z=>setTimeout(z,LATENCY));let j={s:true};
    const v=S.view(), dl={sm:v.sm,st:v.st?new Date(v.st).toISOString():undefined,sp:v.sp?new Date(v.sp).toISOString():undefined,is:S.isBroken?false:v.on,ia:false};
    if(u.includes('/study/start')){S.start();j={s:true,dl:{sm:S.cur().sm}}}
    else if(u.includes('/study/stop')){S.stop();j={s:true,dl:{sm:S.cur().sm}}}
    else if(u.includes('/user/v2/reload/info')) j={s:true,n:'me',ud:1,dl,ss:[{id:1,tt:'국어'}]};
    else if(u.includes('/logs/day')) j={s:true,dl};
    else if(u.includes('/group/members')) j={s:true,ms:[{n:'me',ud:1,dl},{n:'friend',ud:2,dl:{sm:0,is:false}}]};
    else if(u.includes('/group/groups')) j={s:true,gs:[{id:11,t:'G'}]};
    r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(j)})});
  await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
  await p.evaluate(()=>{localStorage.setItem('flysky:guest','1');localStorage.setItem('flysky:ypt',JSON.stringify({jwt:'h.eyJleHAiOjk5OTk5OTk5OTl9.s',authAt:5,uid:1,gid:11}))});
  await p.reload(); await p.evaluate(()=>{document.getElementById('login').classList.remove('open');showView('ypt')}); await p.waitForTimeout(2000);
  const st=()=>p.evaluate(()=>({run:window.__ypt.status().run,clock:document.getElementById('yvStudy').textContent}));
  const tap=async()=>{await p.click('#yvPlay');await p.waitForTimeout(LATENCY+300)};
  return {p,c,errs,st,tap};
}
const secs=c=>{const [h,m,s]=c.split(':').map(Number);return h*3600+m*60+s};
(async()=>{const b=await chromium.launch();const R=[];const ok=(name,cond,info)=>{R.push((cond?'PASS ':'FAIL ')+name+(info?'  '+info:''))};
 if(process.argv[2]==="t7"){} else {
 // T1: start, then stop; stale server keeps saying "on" → must stay stopped, no extra starts
 {const S=makeServer();const t=await setup(b,S);await t.tap();await t.p.waitForTimeout(3000);await t.tap();
  const seq=[];for(let i=0;i<12;i++){await t.p.waitForTimeout(1000);seq.push((await t.st()).run?1:0)}
  ok('T1 stop sticks despite stale "on"',seq.every(x=>x===0)&&S.starts===1,`seq=${seq.join('')} starts=${S.starts} stops=${S.stops}`);await t.c.close()}
 // T2: start, stop, start again quickly → clock must not jump to the old session
 {const S=makeServer();const t=await setup(b,S);await t.tap();await t.p.waitForTimeout(20000);await t.tap();await t.p.waitForTimeout(1500);await t.tap();
  const c0=secs((await t.st()).clock);const vals=[];for(let i=0;i<10;i++){await t.p.waitForTimeout(1000);const s=await t.st();vals.push(s.run?1:0)}
  const c1=secs((await t.st()).clock);
  ok('T2 quick restart: stays running, clock steady',vals.every(x=>x===1)&&c1-c0<=12,`run=${vals.join('')} clock ${c0}->${c1}s starts=${S.starts}`);await t.c.close()}
 // T3: start; stale "off" for a while → must keep running
 {const S=makeServer();const t=await setup(b,S);await t.tap();const seq=[];for(let i=0;i<12;i++){await t.p.waitForTimeout(1000);seq.push((await t.st()).run?1:0)}
  ok('T3 start sticks despite stale "off"',seq.every(x=>x===1),`seq=${seq.join('')}`);await t.c.close()}
 // T4: remote stop (another device) after >60s → reflected
 {const S=makeServer();S.hist.push({t:Date.now()-120000,on:true,st:Date.now()-120000,sm:600000});const t=await setup(b,S);
  const r0=(await t.st()).run; S.stopNow(); const t0=Date.now(); let r=true; for(let i=0;i<40&&r;i++){await t.p.waitForTimeout(500);r=(await t.st()).run}
  ok('T4 remote stop reflected',r0===true&&r===false,`adopted=${r0} after ${((Date.now()-t0)/1000).toFixed(1)}s (server lag ${STALE/1000}s)`);await t.c.close()}
 // T5: remote start → adopted
 {const S=makeServer();const t=await setup(b,S);S.start();S.starts=0;const t0=Date.now();let r=false;for(let i=0;i<60&&!r;i++){await t.p.waitForTimeout(500);r=(await t.st()).run}
  ok('T5 remote start adopted',r,`after ${((Date.now()-t0)/1000).toFixed(1)}s`);await t.c.close()}
 // T6: after stop, clock never goes down
 {const S=makeServer();const t=await setup(b,S);await t.tap();await t.p.waitForTimeout(15000);await t.tap();const c0=secs((await t.st()).clock);let min=c0;
  for(let i=0;i<10;i++){await t.p.waitForTimeout(1000);min=Math.min(min,secs((await t.st()).clock))}
  ok('T6 total never drops after stop',min>=c0,`after stop ${c0}s, min seen ${min}s`);await t.c.close()}
 }
 // T8: server glitches 'not studying' for 25s while the session is really running (sm unchanged)
 {const S=makeServer();const t=await setup(b,S);await t.tap();await t.p.waitForTimeout(70000);S.glitch=true;const seq=[];for(let i=0;i<25;i++){await t.p.waitForTimeout(1000);seq.push((await t.st()).run?1:0)}S.glitch=false;await t.p.waitForTimeout(40000);const end=(await t.st()).run;
  ok('T8 glitch "off": never sends a stop, back to running',end&&S.stops===0,`seq=${seq.join('')} end=${end} stops=${S.stops}`);await t.c.close()}
 // T9: my stop doesn't reach the server (server keeps running) → retry, then show running again (consistent UI)
 {const S=makeServer();const t=await setup(b,S);await t.tap();await t.p.waitForTimeout(3000);S.ignoreStop=true;await t.tap();const seq=[];for(let i=0;i<70;i++){await t.p.waitForTimeout(1000);const x=await t.p.evaluate(()=>({run:window.__ypt.status().run,btn:document.getElementById('yvPlay').innerHTML.includes('M7 5h3.5'),me:!!document.querySelector('#yvMembers .mem.me.study')}));seq.push(x.run===x.btn&&x.btn===x.me?(x.run?1:0):'X')}
  ok('T9 failed stop: follows the server (shown running again); UI always consistent',!seq.includes('X')&&seq[seq.length-1]===1,`seq=${seq.join('')} stops=${S.stops}`);await t.c.close()}
 // T10: on the timer view, YPT app starts then stops
 {const S=makeServer();const t=await setup(b,S);await t.p.evaluate(()=>showView('timer'));S.start();let t0=Date.now(),r=false;for(let i=0;i<60&&!r;i++){await t.p.waitForTimeout(500);r=await t.p.evaluate(()=>window.__ypt.status().run)}const a=((Date.now()-t0)/1000).toFixed(1);
  await t.p.waitForTimeout(65000);S.stopNow();t0=Date.now();for(let i=0;i<60&&r;i++){await t.p.waitForTimeout(500);r=await t.p.evaluate(()=>window.__ypt.status().run)}
  ok('T10 app start/stop while on another view',!r,`adopted in ${a}s, stop reflected in ${((Date.now()-t0)/1000).toFixed(1)}s (server lag ${STALE/1000}s)`);await t.c.close()}
 // T11: start, run 40s, stop: the clock moves smoothly (no jumps up or down)
 {const S=makeServer();S.hist[0].sm=8397000;const t=await setup(b,S);const v=[];const rec=async n=>{for(let i=0;i<n;i++){v.push(secs((await t.st()).clock));await t.p.waitForTimeout(1000)}};await rec(3);await t.tap();await rec(40);await t.tap();await rec(15);
  const d=v.slice(1).map((x,i)=>x-v[i]);ok('T11 clock smooth (no jumps)',d.every(x=>x>=0&&x<=2),`deltas=${d.join(',')}`);await t.c.close()}
 // T12: the real case: YPT app starts but the server keeps is=false (only st moves past sp)
 {const S=makeServer();S.hist[0].sp=Date.now()-600000;S.isBroken=true;const t=await setup(b,S);S.start();let t0=Date.now(),r=false;for(let i=0;i<40&&!r;i++){await t.p.waitForTimeout(500);r=(await t.st()).run}
  const a=((Date.now()-t0)/1000).toFixed(1);S.stopNow();t0=Date.now();for(let i=0;i<60&&r;i++){await t.p.waitForTimeout(500);r=(await t.st()).run}
  ok('T12 app start with is=false is reflected (st>sp), then stop',!r,`start in ${a}s, stop in ${((Date.now()-t0)/1000).toFixed(1)}s`);await t.c.close()}
 // T7: double tap → one start
 {const S=makeServer();const t=await setup(b,S);await t.p.evaluate(()=>{const b=document.getElementById('yvPlay');b.click();setTimeout(()=>b.click(),250)});await t.p.waitForTimeout(3000);
  ok('T7 double tap = single start',S.starts===1&&S.stops===0,`starts=${S.starts} stops=${S.stops}`);await t.c.close()}
 R.forEach(x=>console.log(x));await b.close()})();
