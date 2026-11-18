// Real bug from the user's log: after a Fly stop, the fresh source says "off (sp=stop time, sm 371)",
// but another server response (group members) keeps returning an OLD copy: "on, old sp, sm 368, is ON".
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();
const T0=Date.now();let cur={on:false,st:T0-3600e3,sp:T0-3500e3,sm:368*60e3};let snap=null;let starts=0,stops=0;
const dlOf=v=>({sm:v.sm,st:new Date(v.st).toISOString(),sp:new Date(v.sp).toISOString(),is:v.on,ia:false});
const c=await b.newContext();const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await c.route(/gstatic|googleapis|accounts\.google|jsdelivr/,r=>r.abort());
await c.route(/workers\.dev/,async r=>{const u=r.request().url();await new Promise(z=>setTimeout(z,300));let j={s:true};
  const fresh=dlOf(cur), old=snap?dlOf(snap):fresh;
  if(u.includes('/study/start')){starts++;cur={on:true,st:Date.now(),sp:cur.sp,sm:cur.sm};j={s:true,dl:{sm:cur.sm}}}
  else if(u.includes('/study/stop')){stops++;snap={...cur};cur={on:false,st:cur.st,sp:Date.now(),sm:cur.sm+(Date.now()-cur.st)};j={s:true,dl:{sm:cur.sm}}}
  else if(u.includes('/user/v2/reload/info')) j={s:true,n:'me',ud:1,dl:fresh,ss:[{id:1,tt:'국어'}]};
  else if(u.includes('/logs/day')) j={s:true,dl:fresh};
  else if(u.includes('/group/members')) j={s:true,ms:[{n:'me',ud:1,dl:old},{n:'friend',ud:2,dl:{sm:0,is:false}}]};
  else if(u.includes('/group/groups')) j={s:true,gs:[{id:11,t:'G'}]};
  r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(j)})});
await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
await p.evaluate(()=>{localStorage.setItem('flysky:guest','1');localStorage.setItem('flysky:ypt',JSON.stringify({jwt:'h.eyJleHAiOjk5OTk5OTk5OTl9.s',authAt:5,uid:1,gid:11}))});
const open=async()=>{await p.reload();await p.evaluate(()=>{document.getElementById('login').classList.remove('open');showView('ypt')});};
await open();await p.waitForTimeout(2500);
const run=()=>p.evaluate(()=>window.__ypt.status().run);
await p.click('#yvPlay');await p.waitForTimeout(8000);console.log('running',await run());
await p.click('#yvPlay');let seq='';for(let i=0;i<20;i++){await p.waitForTimeout(1000);seq+=(await run())?1:0}console.log('after stop',seq);
for(let k=0;k<2;k++){await open();seq='';for(let i=0;i<20;i++){await p.waitForTimeout(1000);seq+=(await run())?1:0}console.log('reopen',k+1,seq)}
// app start of a new session later must still show
cur={on:true,st:Date.now(),sp:cur.sp,sm:cur.sm};snap=null;let r=false,t0=Date.now();for(let i=0;i<30&&!r;i++){await p.waitForTimeout(500);r=await run()}
console.log('new app session adopted',r,((Date.now()-t0)/1000).toFixed(1)+'s','starts',starts,'stops',stops);
console.log((await p.evaluate(()=>JSON.parse(localStorage.getItem('flysky:ypt')).log.slice(-6).map(x=>x.e+' '+(x.s||'')))).join('\n'));
console.log(errs);await b.close()})();
