// Randomized YPT sync test. The fake server answers EVERY request with either a fresh state (45%)
// or an independent random OLD copy (5–60 s old) — like the real server mixing fresh and cached data.
// Random YPT-app starts/stops, random Fly taps, random app reopen. Checks rules that must ALWAYS hold.
const {chromium}=require('playwright');
const RUNS=+process.argv[2]||6, DUR=(+process.argv[3]||150)*1000, GRACE=40000;
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}}
async function one(b,seed){
  const R=rng(seed), rnd=(a,c)=>a+R()*(c-a);
  const t0=Date.now();
  let T={on:false,st:t0-7200e3,sp:t0-7000e3,sm:300*60e3,is:false,by:''};
  const snaps=[{t:t0-600e3,...T}]; const push=()=>snaps.push({t:Date.now(),...T});
  const truthLog=[{t:Date.now(),on:false}]; const mark=()=>truthLog.push({t:Date.now(),on:T.on});
  const stopNow=()=>{if(!T.on)return;T={...T,on:false,sp:Date.now(),sm:T.sm+(Date.now()-T.st),is:false};push();mark()};
  const startNow=(by,is)=>{stopNow();T={...T,on:true,st:Date.now(),is,by};push();mark()};
  const snapAt=lag=>{const t=Date.now()-lag;let v=snaps[0];for(const s of snaps)if(s.t<=t)v=s;return v};
  const dl=s=>({sm:s.sm,st:new Date(s.st).toISOString(),sp:new Date(s.sp).toISOString(),is:s.is,ia:false});
  const reqs=[], clicks=[], V=[], reopens=[];
  const c=await b.newContext();const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await c.route(/gstatic|googleapis|accounts\.google|jsdelivr/,r=>r.abort());
  await c.route(/workers\.dev/,async r=>{const u=r.request().url();await new Promise(z=>setTimeout(z,rnd(150,700)));
    const s=R()<0.45?snapAt(rnd(0,1500)):snapAt(rnd(5000,60000));let j={s:true};
    if(u.includes('/study/start')){reqs.push({t:Date.now(),k:'start'});startNow('fly',true);j={s:true,dl:{sm:T.sm}}}
    else if(u.includes('/study/stop')){reqs.push({t:Date.now(),k:'stop'});stopNow();j={s:true,dl:{sm:T.sm}}}
    else if(u.includes('/user/v2/reload/info')) j={s:true,n:'me',ud:1,dl:dl(s),ss:[{id:1,tt:'국어'}]};
    else if(u.includes('/logs/day')) j={s:true,dl:dl(s)};
    else if(u.includes('/group/members')) j={s:true,ms:[{n:'me',ud:1,dl:dl(s)},{n:'friend',ud:2,dl:{sm:0,is:false}}]};
    else if(u.includes('/group/groups')) j={s:true,gs:[{id:11,t:'G'}]};
    r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(j)})});
  await p.goto('file://'+require('path').resolve(__dirname,'../index.html'));
  await p.evaluate(()=>{localStorage.setItem('flysky:guest','1');localStorage.setItem('flysky:ypt',JSON.stringify({jwt:'h.eyJleHAiOjk5OTk5OTk5OTl9.s',authAt:5,uid:1,gid:11}))});
  const open=async()=>{reopens.push(Date.now());await p.reload();await p.evaluate(()=>{document.getElementById('login').classList.remove('open');showView('ypt')})};
  await open();
  const samples=[];let busy=false;
  const sampler=setInterval(async()=>{if(busy)return;busy=true;try{const v=await p.evaluate(()=>({run:!!window.__ypt.status().run,clk:document.getElementById('yvStudy').textContent,d:JSON.stringify(window.__ypt.dbg(),(k,x)=>typeof x==='number'&&x>1.7e12?new Date(x).toTimeString().slice(0,8):(k==='sm'||k==='info')&&typeof x==='number'?Math.round(x/1000):x)}));samples.push({t:Date.now(),...v})}catch(e){}busy=false},500);
  const acts=[];
  while(Date.now()-t0<DUR){
    await new Promise(z=>setTimeout(z,rnd(3000,12000)));
    const x=R();
    try{
      if(x<0.35){const dis=await p.evaluate(()=>document.getElementById('yvPlay').disabled);if(!dis){clicks.push(Date.now());acts.push('tap');await p.click('#yvPlay')}}
      else if(x<0.62){if(T.on){stopNow();acts.push('appStop')}else{startNow('app',R()<0.5);acts.push('appStart')}}
      else if(x<0.77){acts.push('reopen');await open()}
    }catch(e){}
  }
  await new Promise(z=>setTimeout(z,GRACE+5000));   // settle
  clearInterval(sampler);
  // --- checks
  const truthAt=t=>{let v=truthLog[0];for(const e of truthLog)if(e.t<=t)v=e;return v};
  for(const s of samples){const tr=truthAt(s.t);if(s.t-tr.t<GRACE)continue;   // truth stable for GRACE
    if(s.run!==tr.on){V.push(`${((s.t-t0)/1000).toFixed(0)}s: Fly ${s.run?'켜짐':'꺼짐'} / 실제 ${tr.on?'켜짐':'꺼짐'} (실제가 ${((s.t-tr.t)/1000).toFixed(0)}초째 그대로)`);}}
  for(const q of reqs){if(!clicks.some(cl=>q.t>=cl&&q.t-cl<4000))V.push(`${((q.t-t0)/1000).toFixed(0)}s: 누르지 않았는데 ${q.k} 요청`)}
  const secs=c=>{const [h,m,s]=c.split(':').map(Number);return h*3600+m*60+s};
  for(let i=1;i<samples.length;i++){const a=secs(samples[i-1].clk),z=secs(samples[i].clk);if(z<a-2&&a>0&&z>0&&!reopens.some(r=>samples[i].t-r<15000)&&!(a-z<=12&&truthLog.some(e=>e.t<=samples[i].t&&samples[i].t-e.t<15000)))V.push(`${((samples[i].t-t0)/1000).toFixed(0)}s: 오늘 공부 시간이 ${a-z}초 줄어듦\n      before ${samples[i-1].clk} ${samples[i-1].d}\n      after  ${samples[i].clk} ${samples[i].d}`)}
  const log=await p.evaluate(()=>(JSON.parse(localStorage.getItem('flysky:ypt')).log||[]).slice(-14).map(x=>new Date(x.t).toTimeString().slice(0,8)+' '+x.e+' '+(x.s||'')));
  await c.close();
  return {seed,acts:acts.join(','),V:[...new Set(V)],errs,log};
}
(async()=>{const b=await chromium.launch();const seeds=(process.argv[4]?process.argv[4].split(',').map(Number):Array.from({length:RUNS},(_,i)=>1000+i*7919+(+process.env.SEEDOFF||0)));
  const res=await Promise.all(seeds.map(s=>one(b,s)));
  let bad=0;for(const r of res){const ok=!r.V.length&&!r.errs.length;if(!ok)bad++;
    console.log(`${ok?'PASS':'FAIL'} seed ${r.seed}  [${r.acts}]`);if(!ok){r.V.slice(0,6).forEach(v=>console.log('   ',v));r.errs.forEach(e=>console.log('   err',e));console.log('    log:\n      '+r.log.join('\n      '))}}
  console.log(`${res.length-bad}/${res.length} passed`);await b.close()})();
