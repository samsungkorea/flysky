const {chromium}=require('playwright');
const STALE=6000, LAT=400;
function server(){const S={hist:[{t:0,on:false,st:null,sm:3600000,sp:Date.now()-3600000}],starts:0,stops:[],failStop:0,frozen:false,glitch:false};
 S.cur=()=>S.hist[S.hist.length-1];
 S.view=()=>{if(S.frozen)return S.frozenView;const t=Date.now()-STALE;let v=S.hist[0];for(const h of S.hist)if(h.t<=t)v=h;return S.glitch?{...v,on:false,st:null,sp:null}:v};
 S.start=()=>{S.hist.push({t:Date.now(),on:true,st:Date.now(),sm:S.cur().sm,sp:S.cur().sp});S.starts++};
 S.stopAt=(startedAt)=>{const c=S.cur();S.hist.push({t:Date.now(),on:false,st:c.st,sm:c.sm+(Date.now()-(startedAt||c.st)),sp:Date.now()})};
 return S}
async function open(b,S,ctx){const c=ctx||await b.newContext();const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 if(!ctx){await c.route(/gstatic|googleapis|accounts\.google|jsdelivr/,r=>r.abort());
 await c.route(/workers\.dev/,async r=>{const u=r.request().url();await new Promise(z=>setTimeout(z,LAT));const v=S.view();
  const dl={sm:v.sm,st:v.st?new Date(v.st).toISOString():undefined,sp:v.sp?new Date(v.sp).toISOString():undefined,is:v.on,ia:false};let j={s:true};
  if(u.includes('/study/start')){S.start();j={s:true,dl:{sm:S.cur().sm}}}
  else if(u.includes('/study/stop')){if(S.failStop>0){S.failStop--;return r.abort()}const b=JSON.parse(r.request().postData()||'{}');S.stops.push(b.startedAt);S.stopAt(b.startedAt);j={s:true,dl:{sm:S.cur().sm}}}
  else if(u.includes('/user/v2/reload/info'))j={s:true,n:'me',ud:1,dl,ss:[{id:1,tt:'국어'}]};
  else if(u.includes('/logs/day'))j={s:true,dl};
  else if(u.includes('/group/members'))j={s:true,ms:[{n:'me',ud:1,dl}]};
  else if(u.includes('/group/groups'))j={s:true,gs:[{id:11,t:'G'}]};
  r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(j)})});
  await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
  await p.evaluate(()=>{localStorage.setItem('flysky:guest','1');localStorage.setItem('flysky:ypt',JSON.stringify({jwt:'h.eyJleHAiOjk5OTk5OTk5OTl9.s',authAt:5,uid:1,gid:11}))});
  await p.reload();} else await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
 await p.evaluate(()=>{document.getElementById('login').classList.remove('open');showView('ypt')});await p.waitForTimeout(2000);
 const st=()=>p.evaluate(()=>({run:window.__ypt.status().run,clock:document.getElementById('yvStudy').textContent}));
 return {c,p,errs,st}}
const secs=c=>{const [h,m,s]=c.split(':').map(Number);return h*3600+m*60+s};
async function watch(t,n){const seq=[];for(let i=0;i<n;i++){seq.push((await t.st()).run?1:0);await t.p.waitForTimeout(1000)}return seq}
(async()=>{const b=await chromium.launch();const R=[];const ok=(n,c,i)=>R.push((c?'PASS ':'FAIL ')+n+'  '+i);
 // G1 close the app for 60s, reopen
 {const S=server();let t=await open(b,S);await t.p.click('#yvPlay');await t.p.waitForTimeout(5000);const c0=secs((await t.st()).clock);const ctx=t.c;await t.p.close();
  await new Promise(z=>setTimeout(z,60000));t=await open(b,S,ctx);await t.p.waitForTimeout(3000);const s=await t.st();const seq=await watch(t,20);
  ok('G1 app closed 60s → still recording, time includes the closed minute',s.run&&seq.every(x=>x)&&secs(s.clock)-c0>=60&&S.stops.length===0,`clock ${c0}→${secs(s.clock)}s, seq=${seq.join('')}, stops=${S.stops.length}`);await ctx.close()}
 // G2 server says "not studying" without a stop time (glitch) for 60s
 {const S=server();const t=await open(b,S);await t.p.click('#yvPlay');await t.p.waitForTimeout(10000);S.glitch=true;const seq=await watch(t,60);S.glitch=false;
  ok('G2 60s of "not studying" without a stop → keeps recording',seq.every(x=>x)&&S.stops.length===0,`seq=${seq.join('')}`);await t.c.close()}
 // G3 server never shows the Fly session at all for 70s (frozen view)
 {const S=server();S.frozen=true;S.frozenView=S.hist[0];const t=await open(b,S);await t.p.click('#yvPlay');await t.p.waitForTimeout(1500);const seq=await watch(t,70);
  ok('G3 server never shows the session for 70s → keeps recording',seq.every(x=>x)&&S.stops.length===0,`seq=${seq.join('')}`);await t.c.close()}
 // G4 stop with no network → keeps recording; retry → recorded from the original start
 {const S=server();const t=await open(b,S);await t.p.click('#yvPlay');await t.p.waitForTimeout(4000);const startedAt=await t.p.evaluate(()=>JSON.parse(localStorage.getItem('flysky:ypt')).run.startedAt);
  S.failStop=1;await t.p.waitForTimeout(1000);await t.p.click('#yvPlay');await t.p.waitForTimeout(16500);const mid=(await t.st()).run;await t.p.click('#yvPlay');await t.p.waitForTimeout(2000);const end=(await t.st()).run;
  ok('G4 stop fails offline → still recording; retry records from original start',mid&&!end&&S.stops.length===1&&Math.abs(S.stops[0]-startedAt)<2000,`after failed stop run=${mid}, after retry run=${end}, stop startedAt diff=${S.stops[0]-startedAt}ms`);await t.c.close()}
 // G5 real stop from the YPT app (stop time after our start) → reflected
 {const S=server();const t=await open(b,S);await t.p.click('#yvPlay');await t.p.waitForTimeout(20000);S.stopAt();let r=true,t0=Date.now();for(let i=0;i<60&&r;i++){await t.p.waitForTimeout(500);r=(await t.st()).run}
  ok('G5 stop in the YPT app is still reflected',!r,`after ${((Date.now()-t0)/1000).toFixed(1)}s`);await t.c.close()}
 R.forEach(x=>console.log(x));await b.close()})();
