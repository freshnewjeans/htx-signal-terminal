// HTX Futures Signal Terminal — Backtester
// Reuses the exact engine from the app (EMA + candlestick patterns + retrace + rejection + S/R breakout).
// Pulls live HTX USDT-perpetual history and measures entry winrate / R:R / expectancy.

'use strict';
const fs = require('fs');
const path = require('path');

/* ================= Engine (mirrors the app) ================= */
function bd(c){ return Math.abs(c.close - c.open); }
function rg(c){ return (c.high - c.low) || 1; }
function us(c){ return c.high - Math.max(c.open,c.close); }
function ls(c){ return Math.min(c.open,c.close) - c.low; }
function emaSeries(vals, period){
  const out = new Array(vals.length).fill(null);
  if(vals.length < period) return out;
  const k = 2/(period+1);
  let seed = 0;
  for(let i=0;i<period;i++) seed += vals[i];
  seed /= period;
  out[period-1] = seed;
  for(let i=period;i<vals.length;i++) out[i] = vals[i]*k + out[i-1]*(1-k);
  return out;
}
function detectPatterns(cs){
  const map = {};
  const add = (i,o)=>{ (map[i]=map[i]||[]).push(o); };
  for(let i=1;i<cs.length;i++){
    const c=cs[i], p=cs[i-1];
    const body=bd(c), rng=rg(c), up=us(c), lo=ls(c);
    const prevBody=bd(p), prevRng=rg(p);
    const bullishPrev = p.close > p.open, bearishPrev = p.close < p.open;
    const midBody=(p.open+p.close)/2, midRng=(p.high+p.low)/2;
    if(body>0){
      if(lo>=2*body && up<=0.5*body) add(i,{n:'Hammer',dir:1,str:2});
      else if(up>=2*body && lo<=0.5*body) add(i,{n:'Shooting Star',dir:-1,str:2});
    }
    if(rng>0 && body<=0.1*rng) add(i,{n:'Doji',dir:0,str:1});
    if(bearishPrev && c.close>c.open && c.close>=p.open && c.open<=p.close && body>prevBody) add(i,{n:'Bullish Engulfing',dir:1,str:3});
    if(bullishPrev && c.close<c.open && c.close<=p.open && c.open>=p.close && body>prevBody) add(i,{n:'Bearish Engulfing',dir:-1,str:3});
    if(bearishPrev && c.close>c.open && c.open<p.low && c.close>midBody && c.close<p.open) add(i,{n:'Piercing Line',dir:1,str:2});
    if(bullishPrev && c.close<c.open && c.open>p.high && c.close<midBody && c.close>p.close) add(i,{n:'Dark Cloud Cover',dir:-1,str:2});
    if(i>=2){
      const pp=cs[i-2];
      if(pp.close<pp.open && bearishPrev && bd(pp)>=0.3*rg(pp) && bd(p)<=0.3*rg(p) && c.close>c.open && c.close>midRng) add(i,{n:'Morning Star',dir:1,str:3});
      if(pp.close>pp.open && bullishPrev && bd(pp)>=0.3*rg(pp) && bd(p)<=0.3*rg(p) && c.close<c.open && c.close<midRng) add(i,{n:'Evening Star',dir:-1,str:3});
      if(c.close>c.open && p.close>p.open && pp.close>pp.open && c.close>p.close && p.close>pp.close) add(i,{n:'Three White Soldiers',dir:1,str:3});
      if(c.close<c.open && p.close<p.open && pp.close<pp.open && c.close<p.close && p.close<pp.close) add(i,{n:'Three Black Crows',dir:-1,str:3});
    }
  }
  return map;
}
function atrSeries(cs, period){
  const n=cs.length, out=new Array(n).fill(null);
  if(n<=period) return out;
  const trs=[];
  for(let i=1;i<n;i++) trs.push(Math.max(cs[i].high-cs[i].low, Math.abs(cs[i].high-cs[i-1].close), Math.abs(cs[i].low-cs[i-1].close)));
  let seed=0; for(let k=0;k<period;k++) seed+=trs[k]; seed/=period;
  out[period]=seed;
  for(let k=period;k<trs.length;k++){ seed=(seed*(period-1)+trs[k])/period; out[k+1]=seed; }
  return out;
}
function rejectionAt(cs, j, dir, entry, tol){
  const c=cs[j], p=cs[j-1];
  if(!p) return null;
  const body=bd(c), rng=rg(c), up=us(c), lo=ls(c);
  if(dir==='LONG'){
    if(c.low > entry + tol) return null;
    if(c.close <= entry) return null;
    const engulf = (p.close<p.open) && c.close>c.open && c.close>=p.open && c.open<=p.close && body>bd(p);
    if(engulf) return 'Bullish Engulfing';
    if(lo >= Math.max(body, rng*0.3)) return 'Pin bar';
    return null;
  } else {
    if(c.high < entry - tol) return null;
    if(c.close >= entry) return null;
    const engulf = (p.close>p.open) && c.close<c.open && c.close<=p.open && c.open>=p.close && body>bd(p);
    if(engulf) return 'Bearish Engulfing';
    if(up >= Math.max(body, rng*0.3)) return 'Pin bar';
    return null;
  }
}
function findNearbyLevel(cs, sigIdx, dir, refPrice, atrVal){
  const win=50, lo=Math.max(0,sigIdx-win), hi=Math.min(sigIdx,cs.length-1);
  if(hi-lo<4) return null;
  const pivots=[];
  for(let i=lo+1;i<hi;i++){
    const h=cs[i].high, l=cs[i].low;
    if(cs[i-1].high<h && cs[i+1].high<h) pivots.push({p:h,kind:'res'});
    if(cs[i-1].low>l && cs[i+1].low>l) pivots.push({p:l,kind:'sup'});
  }
  if(!pivots.length) return null;
  const levelTol = Math.max(1.2*atrVal, refPrice*0.012);
  let best=null;
  if(dir==='LONG'){
    for(const pv of pivots){ if(pv.kind==='res' && pv.p>refPrice && pv.p<=refPrice+levelTol && (!best||pv.p<best.p)) best={price:pv.p,side:'res'}; }
  } else {
    for(const pv of pivots){ if(pv.kind==='sup' && pv.p<refPrice && pv.p>=refPrice-levelTol && (!best||pv.p>best.p)) best={price:pv.p,side:'sup'}; }
  }
  return best;
}
function computeSetup(cs, sigIdx, dir, cfg, atrArr){
  const W=30, lo=Math.max(0,sigIdx-W);
  let swingHigh=-Infinity, swingLow=Infinity;
  for(let j=lo;j<=sigIdx;j++){ if(cs[j].high>swingHigh) swingHigh=cs[j].high; if(cs[j].low<swingLow) swingLow=cs[j].low; }
  const range=swingHigh-swingLow;
  if(range<=0) return null;
  const fib=Math.max(0.05,Math.min(0.95,cfg.fib/100));
  const atrVal=(atrArr&&atrArr[sigIdx])?atrArr[sigIdx]:range*0.03;
  const buff=atrVal*(cfg.buff??1);
  const fibEntry=(dir==='LONG')?(swingHigh-range*fib):(swingLow+range*fib);
  const level=findNearbyLevel(cs,sigIdx,dir,fibEntry,atrVal);
  const hasLevel=!!level;
  const entryLevel=hasLevel?level.price:fibEntry;
  const breakLevel=hasLevel?level.price:(dir==='LONG'?swingHigh:swingLow);
  let entry, stop, take;
  if(dir==='LONG'){ entry=entryLevel; stop=swingLow-buff; take=entry+cfg.rr*(entry-stop); }
  else { entry=entryLevel; stop=swingHigh+buff; take=entry-cfg.rr*(stop-entry); }
  const r=Math.abs(entry-stop);
  if(r<=0) return null;
  const tol=Math.max(range*0.01,buff*0.5);
  let status='awaiting',fillPrice=null,fillT=null,rej=null,outcome=null,exitT=null,exitPrice=null;
  let brokenOut=false;
  for(let j=sigIdx+1;j<cs.length;j++){
    if(dir==='LONG'){
      if(status==='awaiting'){
        if(!brokenOut && cs[j].close>breakLevel) brokenOut=true;
        if(brokenOut){ rej=rejectionAt(cs,j,'LONG',entry,tol); if(rej){status='in';fillPrice=cs[j].close;fillT=j;} }
      } else if(status==='in'){
        if(cs[j].high>=take){status='tp';outcome='TP';exitT=j;exitPrice=take;break;}
        if(cs[j].low<=stop){status='sl';outcome='SL';exitT=j;exitPrice=stop;break;}
      }
    } else {
      if(status==='awaiting'){
        if(!brokenOut && cs[j].close<breakLevel) brokenOut=true;
        if(brokenOut){ rej=rejectionAt(cs,j,'SHORT',entry,tol); if(rej){status='in';fillPrice=cs[j].close;fillT=j;} }
      } else if(status==='in'){
        if(cs[j].low<=take){status='tp';outcome='TP';exitT=j;exitPrice=take;break;}
        if(cs[j].high>=stop){status='sl';outcome='SL';exitT=j;exitPrice=stop;break;}
      }
    }
  }
  return {dir,entry,stop,take,r,rr:cfg.rr,mode:'breakout',level:breakLevel,side:hasLevel?level.side:(dir==='LONG'?'res':'sup'),hasLevel,
    status,fillPrice,fillT,rej,outcome,exitT,exitPrice};
}
function buildSignals(cs, cfg){
  const closes=cs.map(c=>c.close);
  const e9=emaSeries(closes,cfg.fast), e21=emaSeries(closes,cfg.mid), e50=emaSeries(closes,cfg.slow);
  const pats=detectPatterns(cs);
  const lastIdx=Math.max(0,cs.length-2);
  const sigs=[];
  const mk=(i,dir,name,conf,note)=>({i,time:cs[i].time,dir,name,conf,price:cs[i].close,note});
  for(let i=1;i<=lastIdx;i++){
    if(e9[i]===null||e21[i]===null) continue;
    const uptrend=cs[i].close>e21[i]&&e9[i]>e21[i];
    const downtrend=cs[i].close<e21[i]&&e9[i]<e21[i];
    let crossed=null;
    if(e9[i-1]!==null&&e9[i-1]<=e21[i-1]&&e9[i]>e21[i]) crossed='gold';
    else if(e9[i-1]!==null&&e9[i-1]>=e21[i-1]&&e9[i]<e21[i]) crossed='death';
    const plist=pats[i]||[];
    let bull=null,bear=null;
    for(const p of plist){ if(p.dir===1) bull=p; else if(p.dir===-1) bear=p; }
    if(crossed==='gold') sigs.push(mk(i,'LONG',bull?('EMA Cross + '+bull.n):'EMA Golden Cross','High',null));
    else if(crossed==='death') sigs.push(mk(i,'SHORT',bear?('EMA Cross + '+bear.n):'EMA Death Cross','High',null));
    if(bull&&!crossed) sigs.push(mk(i,'LONG',bull.n,uptrend?'Med':'Low',null));
    if(bear&&!crossed) sigs.push(mk(i,'SHORT',bear.n,downtrend?'Med':'Low',null));
  }
  sigs.sort((a,b)=>b.i-a.i);
  const atrArr=atrSeries(cs,14);
  for(const s of sigs) s.setup=computeSetup(cs,s.i,s.dir,cfg,atrArr);
  const entries=[];
  for(const s of sigs){
    const sp=s.setup;
    if(!sp) continue;
    if(sp.status==='in'||sp.status==='tp'||sp.status==='sl'){
      entries.push({dir:s.dir,name:s.name,conf:s.conf,rej:sp.rej||'rejection',
        time:(sp.fillT!=null&&cs[sp.fillT])?cs[sp.fillT].time:s.time,
        fillPrice:sp.fillPrice,stop:sp.stop,take:sp.take,
        mode:sp.mode, level:sp.level, side:sp.side,
        outcome:sp.status==='tp'?'TP':(sp.status==='sl'?'SL':'OPEN')});
    }
  }
  entries.sort((a,b)=>b.time-a.time);
  return {entries};
}

/* ================= Backtest config & data ================= */
const CFG = { fast:9, mid:21, slow:50, fib:50, rr:2, buff:1.0, minEntry:'4h' };
const SYMBOLS = ['BTC-USDT','ETH-USDT','SOL-USDT','XRP-USDT','DOGE-USDT','ADA-USDT','BNB-USDT','LINK-USDT','AVAX-USDT','PEPE-USDT','LTC-USDT','SUI-USDT'];
const TFS = [ {k:'4h',p:'4hour',l:'4H'}, {k:'1d',p:'1day',l:'1D'}, {k:'1w',p:'1week',l:'1W'} ];
const SIZE = 2000;

async function fetchKlines(contract, period, size){
  const url = 'https://api.hbdm.com/linear-swap-ex/market/history/kline?contract_code='+encodeURIComponent(contract)+'&period='+period+'&size='+size;
  const r = await fetch(url, {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('HTTP '+r.status+' '+contract+' '+period);
  const j = await r.json();
  if(j.status!=='ok') throw new Error('API '+contract+' '+period);
  return (j.data||[]).map(d=>({time:d.id,open:d.open,high:d.high,low:d.low,close:d.close,vol:d.vol}));
}

/* ================= Stats ================= */
function pnlR(e){
  if(e.outcome==='OPEN') return null;
  if(e.dir==='LONG'){ const risk=e.fillPrice-e.stop; return e.outcome==='TP'?(e.take-e.fillPrice)/risk:(e.stop-e.fillPrice)/risk; }
  else { const risk=e.stop-e.fillPrice; return e.outcome==='TP'?(e.fillPrice-e.take)/risk:(e.fillPrice-e.stop)/risk; }
}
function stats(entries){
  const closed=entries.filter(e=>e.outcome!=='OPEN');
  const open=entries.filter(e=>e.outcome==='OPEN');
  const wins=closed.filter(e=>e.outcome==='TP');
  const losses=closed.filter(e=>e.outcome==='SL');
  const pr=closed.map(e=>pnlR(e)).filter(v=>v!==null&&isFinite(v));
  const winR=pr.filter(v=>v>0), lossR=pr.filter(v=>v<0);
  const sumR=pr.reduce((a,b)=>a+b,0);
  const grossWin=winR.reduce((a,b)=>a+b,0), grossLoss=Math.abs(lossR.reduce((a,b)=>a+b,0));
  const avgWin=winR.length?grossWin/winR.length:0;
  const avgLoss=lossR.length?grossLoss/lossR.length:0;
  const equity=[];
  let cum=0;
  const timeSorted=closed.slice().sort((a,b)=>a.time-b.time);
  for(const e of timeSorted){ const p=pnlR(e); if(p!==null&&isFinite(p)){ cum+=p; equity.push({time:e.time, cum:Math.round(cum*1000)/1000}); } }
  let peak=0, maxDD=0;
  for(const pt of equity){ if(pt.cum>peak) peak=pt.cum; const dd=peak-pt.cum; if(dd>maxDD) maxDD=dd; }
  return {
    totalSignals: entries.length + closed.length, // approx; entries are trades
    entries: entries.length,
    closed: closed.length, open: open.length,
    wins: wins.length, losses: losses.length,
    winrate: closed.length? Math.round(10000*wins.length/closed.length)/100 : null,
    avgWinR: Math.round(1000*avgWin)/1000, avgLossR: Math.round(1000*avgLoss)/1000,
    expectancyR: closed.length? Math.round(1000*sumR/closed.length)/1000 : null,
    profitFactor: grossLoss>0? Math.round(1000*grossWin/grossLoss)/1000 : null,
    totalR: Math.round(1000*sumR)/1000,
    maxDrawdownR: Math.round(1000*maxDD)/1000,
    equity
  };
}

/* ================= Run ================= */
async function main(){
  const out = { generated:new Date().toISOString(), config:CFG, symbols:SYMBOLS, timeframes:TFS.map(t=>t.l), size:SIZE, runs:[] };
  const allEntries=[];
  const queue=[];
  for(const sym of SYMBOLS) for(const tf of TFS) queue.push({sym,tf});
  const workers=Array.from({length:4}, async ()=>{
    while(queue.length){
      const {sym,tf}=queue.shift();
      try{
        const cs=await fetchKlines(sym,tf.p,SIZE);
        const first=cs.length?new Date(cs[0].time*1000).toISOString().slice(0,10):null;
        const last=cs.length?new Date(cs[cs.length-1].time*1000).toISOString().slice(0,10):null;
        const {entries}=buildSignals(cs,CFG);
        for(const e of entries) e.symbol=sym; for(const e of entries) e.tf=tf.l;
        allEntries.push(...entries);
        out.runs.push({symbol:sym,tf:tf.l,candles:cs.length,range:[first,last],entries:entries.length,stats:stats(entries)});
        console.log('OK  '+sym+' '+tf.l+' candles='+cs.length+' entries='+entries.length);
      }catch(e){ console.log('ERR '+sym+' '+tf.l+' '+e.message); }
    }
  });
  await Promise.all(workers);
  out.overall = stats(allEntries);
  // group by symbol / tf / direction / mode
  const by={};
  for(const key of ['symbol','tf','dir','mode']){
    by[key]={};
    const seen=new Set();
    for(const e of allEntries){ const v=e[key]??(key==='dir'?(e.dir):(key==='mode'?e.mode:'?')); if(v===undefined) continue; (by[key][v]=by[key][v]||[]).push(e); }
    for(const k in by[key]) by[key][k]=stats(by[key][k]);
  }
  out.grouped=by;
  // chronological trade list for report
  out.trades = allEntries.slice().sort((a,b)=>a.time-b.time).map(e=>({
    time:e.time, symbol:e.symbol, tf:e.tf, dir:e.dir, mode:e.mode, rej:e.rej,
    fillPrice:Math.round(e.fillPrice*100)/100, stop:Math.round(e.stop*100)/100, take:Math.round(e.take*100)/100,
    outcome:e.outcome, rr:Math.round((pnlR(e)??0)*100)/100
  }));
  const dir=path.join(__dirname,'results.json');
  fs.writeFileSync(dir, JSON.stringify(out,null,2));
  console.log('\n==== OVERALL ====');
  console.log(JSON.stringify(out.overall,null,2));
}
main().catch(e=>{ console.error(e); process.exit(1); });
