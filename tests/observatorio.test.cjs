const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const JS=fs.readFileSync("app.js","utf8");
const HTML=fs.readFileSync("index.html","utf8");
const START=Date.parse("2026-11-15T05:00:00.000Z");

function harness(now=START+52*60000){
  const store=new Map(),elements=new Map(),events=new Map();
  class FakeDate extends Date {
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return now;}
  }
  const document={
    hidden:false,
    getElementById(id){
      if(!elements.has(id))elements.set(id,{
        id,textContent:"",innerHTML:"",className:"",disabled:false,href:"",
        addEventListener:(name,cb)=>events.set(id+":"+name,cb),
      });
      return elements.get(id);
    },
    addEventListener:(name,cb)=>events.set("document:"+name,cb),
  };
  const ctx={
    document,Date:FakeDate,console,Intl,clearTimeout:()=>{},
    setTimeout:()=>1,setInterval:()=>1,
    localStorage:{
      getItem:key=>store.has(key)?store.get(key):null,
      setItem:(key,value)=>store.set(key,String(value)),
      removeItem:key=>store.delete(key)
    }
  };
  vm.createContext(ctx);
  vm.runInContext(JS,ctx,{filename:"app.js"});
  return {ctx,document,store,events,now};
}
function rows(now,count=100,step=30000){
  return Array.from({length:count},(_,i)=>{
    const roll=i%15;
    return {id:"r"+i,roll,color:roll===0?0:roll<=7?1:2,
      created_at:new Date(now-30000-i*step).toISOString()};
  });
}
function singleSequence(start,colors,step=30000){
  return colors.map((c,i)=>({
    id:"s"+i,t:start+15000+i*step,c,
    roll:c===0?0:c===1?2:11
  }));
}
test("S� existe uma fonte, sem hist�rico Blaze nem importa��o manual",()=>{
  assert.match(JS,/blitz4\.casino\/api\/singleplayer-originals/);
  assert.doesNotMatch(JS,/historicosblaze|clipboard|parsePastedNumbers|sourceMode|pasteRolls/i);
  assert.doesNotMatch(HTML,/historicosblaze|clipboardImport|officialPaste|manualOfficialImport|testar as cores manualmente|atualizacao-automatica\.js/i);
});
test("Usa exatamente o endpoint oficial sem datas e sem par�metros",()=>{
  const {ctx}=harness();
  const endpoint=ctx.buildApiUrl();
  assert.equal(endpoint,"https://blitz4.casino/api/singleplayer-originals/originals/roulette_games/recent/history/1?");
  assert.equal(endpoint.split("?")[1],"");
});
test("Valida 100 resultados oficiais e organiza do antigo ao recente",()=>{
  const {ctx,now}=harness();
  const sample=ctx.normalizeOfficial({records:rows(now)},now);
  assert.equal(sample.length,100);
  assert.ok(sample[0].t<sample[99].t);
  assert.equal(sample[99].id,"r0");
});
test("Rejeita n�mero ou cor inconsistentes",()=>{
  const {ctx,now}=harness();
  assert.equal(ctx.validateRound({id:1,roll:0,color:1,created_at:new Date(now-30000).toISOString()},now),null);
  assert.equal(ctx.validateRound({id:1,roll:12,color:1,created_at:new Date(now-30000).toISOString()},now),null);
  assert.equal(ctx.validateRound({id:1,roll:7,color:1,created_at:new Date(now-30000).toISOString()},now).c,1);
});
test("Rejeita resultados do dia 13 como se fossem ao vivo no dia 15",()=>{
  const {ctx,now}=harness();
  const old=rows(now-2*86400000);
  assert.throws(()=>ctx.normalizeOfficial({records:old},now));
  const stale=rows(now-30*60000);
  assert.throws(()=>ctx.normalizeOfficial({records:stale},now),/antigos/);
});
test("Uma coleta real simulada atualiza somente os 100 oficiais",async()=>{
  const {ctx,document,store,now}=harness();
  const payload={records:rows(now),total_pages:999};
  let calls=0;
  ctx.fetch=async (url,options)=>{
    calls++;
    assert.equal(url,"https://blitz4.casino/api/singleplayer-originals/originals/roulette_games/recent/history/1?");
    assert.equal(options.mode,"cors");
    assert.equal(options.credentials,"omit");
    return {status:200,ok:true,json:async()=>payload};
  };
  await ctx.updateLive();
  assert.equal(calls,1);
  assert.equal(document.getElementById("sampleTotal").textContent,"100");
  assert.equal(document.getElementById("statusBadge").textContent,"Conectado � Blitz");
  assert.match(document.getElementById("rounds").innerHTML,/class="round c/);
  const archive=JSON.parse(store.get("ofa_apenas_blitz_live_v1"));
  assert.equal(archive.source,"Blitz API oficial");
  assert.equal(archive.records.length,100);
  await ctx.updateLive();
  assert.equal(calls,1,"O bot�o n�o deve fazer consultas repetidas imediatamente");
});
test("Uma sequ�ncia cont�nua registra branco na tentativa 7",()=>{
  const {ctx}=harness(START+10*60000);
  const sample=singleSequence(START,[1,1,2,2,2,2,2,2,0]);
  ctx.mergeOfficial(sample,START+10*60000);
  const outcome=ctx.hourResults(START+10*60000)[0];
  assert.equal(outcome.status,"acerto");
  assert.equal(outcome.attempt,7);
});
test("11 rodadas sem branco � falha",()=>{
  const {ctx}=harness(START+10*60000);
  ctx.mergeOfficial(singleSequence(START,[1,1,...Array(11).fill(2)]),START+10*60000);
  const outcome=ctx.hourResults(START+10*60000)[0];
  assert.equal(outcome.status,"falha");
});
test("Lacuna na sequ�ncia n�o gera acerto nem falha",()=>{
  const {ctx}=harness(START+10*60000);
  const data=singleSequence(START,[1,1,2,2,2,2,2,2,0]);
  data.slice(3).forEach(r=>{r.t+=240000;});
  ctx.mergeOfficial(data,START+10*60000);
  assert.equal(ctx.hourResults(START+10*60000)[0].status,"incompleto");
});
test("HTTP 429 respeita o intervalo e n�o consulta repetidamente",async()=>{
  const {ctx,document}=harness();
  let count=0;
  ctx.fetch=async()=>({ok:false,status:429,headers:{get:()=>String(600)}});
  await ctx.updateLive();
  assert.equal(document.getElementById("statusBadge").textContent,"Aguardando libera��o");
  await ctx.updateLive();
  assert.match(document.getElementById("nextUpdate").textContent,/Nova tentativa/);
});
test("HTTP 451 encerra consulta autom�tica sem fazer nova tentativa",async()=>{
  const {ctx,document}=harness();
  let count=0;
  ctx.fetch=async()=>{count++;return {ok:false,status:451}};
  await ctx.updateLive();
  await ctx.updateLive();
  assert.equal(count,1);
  assert.equal(document.getElementById("statusBadge").textContent,"Acesso n�o autorizado");
  assert.equal(document.getElementById("refreshBtn").disabled,true);
});
test("Falha CORS/rede n�o exibe dados antigos como sucesso",async()=>{
  const {ctx,document}=harness();
  ctx.fetch=async()=>{throw new TypeError("Failed to fetch")};
  await ctx.updateLive();
  assert.equal(document.getElementById("sampleTotal").textContent,"-");
  assert.equal(document.getElementById("statusBadge").textContent,"Conex�o indispon�vel");
  assert.match(document.getElementById("notice").textContent,/CORS/);
});


test("Identifica na tela a URL realmente utilizada sem datas",()=>{
  const {ctx,document}=harness();
  assert.equal(document.getElementById("requestedUrl").textContent,
    "https://blitz4.casino/api/singleplayer-originals/originals/roulette_games/recent/history/1?");
  assert.equal(ctx.buildApiUrl(),document.getElementById("requestedUrl").textContent);
});
test("Falha sem status HTTP informa CORS ou rede, n�o inventa um c�digo",async()=>{
  const {ctx,document}=harness();
  ctx.fetch=async()=>{throw new TypeError("Failed to fetch")};
  await ctx.updateLive();
  const reason=document.getElementById("requestInfo").textContent;
  assert.match(reason,/CORS/);
  assert.match(reason,/falha de rede/);
  assert.doesNotMatch(reason,/HTTP (403|429|451)/);
});


test("Hist�rico acumula no m�ximo 300 registros oficiais, sem fontes alternativas",()=>{
  const {ctx,store,now}=harness();
  const data=Array.from({length:370},(_,i)=>({
    id:"history"+i,t:now-370000+i*1000,
    c:i%15===0?0:i%15<=7?1:2,roll:i%15
  }));
  ctx.mergeOfficial(data,now);
  const saved=JSON.parse(store.get("ofa_apenas_blitz_live_v1"));
  assert.equal(saved.records.length,300);
  assert.equal(saved.source,"Blitz API oficial");
  assert.equal(ctx.loadOfficialArchive(now).length,300);
});
test("A API pode responder menos de 100 resultados e ainda ser v�lida",()=>{
  const {ctx,now}=harness();
  assert.equal(ctx.normalizeOfficial({records:rows(now,21)},now).length,21);
});
test("Brancos: intervalo calculado apenas entre rodadas sem lacunas",()=>{
  const {ctx}=harness();
  const results=singleSequence(START,[0,1,2,0,2,0]);
  let sum=ctx.whiteIntervalStats(results);
  assert.equal(sum.whites,3);
  assert.equal(sum.intervals,2);
  assert.equal(sum.max,2);
  assert.equal(sum.mean,1.5);
  results[4].t+=600000;
  results[5].t+=600000;
  sum=ctx.whiteIntervalStats(results);
  assert.equal(sum.intervals,1);
});
test("Atualiza��o sem dados atuais n�o apresenta grade antiga como ao vivo",()=>{
  const {ctx,document,now}=harness();
  const old=singleSequence(START,[0,1,2]);
  ctx.mergeOfficial(old,now);
  ctx.renderRounds();
  assert.match(document.getElementById("rounds").textContent,/ficou antiga/);
});


test("Falha sem c�digo HTTP n�o � descrita como recusa confirmada pelo servidor",async()=>{
  const {ctx,document}=harness();
  ctx.fetch=async()=>{throw new TypeError("Failed to fetch")};
  await ctx.updateLive();
  assert.match(document.getElementById("nextUpdate").textContent,/CORS ou rede/);
  assert.doesNotMatch(document.getElementById("nextUpdate").textContent,/servidor n�o autorizou/i);
  assert.equal(document.getElementById("refreshBtn").textContent,"N�o foi poss�vel conectar");
});

test("SSE atualiza grade e experimento, reconex�o n�o duplica rodadas",()=>{
  const {ctx,document,store,now}=harness(START+8*60000);
  const records=singleSequence(START,[1,1,2,2,2,2,2,2,0]).map(r=>({
    id:r.id,roll:r.roll,color:r.c,created_at:new Date(r.t).toISOString()
  }));
  const snapshot={status:"live",records,checked_at:now,next_check:now+15000,message:"Teste local"};
  ctx.receiveSnapshot(snapshot);
  ctx.receiveSnapshot(snapshot);
  assert.equal(JSON.parse(store.get("ofa_apenas_blitz_live_v1")).records.length,9);
  assert.equal(document.getElementById("signalHits").textContent,"1");
  assert.match(document.getElementById("historyRows").innerHTML,/7\/11/);
  assert.match(document.getElementById("rounds").innerHTML,/class="round/);
  ctx.receiveSnapshot({status:"unavailable",checked_at:now,message:"Offline"});
  assert.equal(JSON.parse(store.get("ofa_apenas_blitz_live_v1")).records.length,9);
  assert.equal(document.getElementById("statusBadge").textContent,"Conex�o indispon�vel");
});

test("Modo local usa uma conex�o SSE e nunca consulta a Blitz pelo navegador",async()=>{
  const {ctx,now}=harness();
  const callbacks=new Map();let opened=0,requests=0;
  const source=JS.replace('const LOCAL_STREAM = typeof window !== "undefined" &&\n  ["127.0.0.1", "localhost", "[::1]"].includes(window.location?.hostname);','const LOCAL_STREAM = true;');
  const local={...ctx, window:{location:{hostname:"127.0.0.1"}},
    fetch:async()=>{requests++;throw Error("N�o deveria consultar");},
    EventSource:class {constructor(url){assert.equal(url,"/events");opened++;} addEventListener(type,fn){callbacks.set(type,fn);}}
  };
  vm.createContext(local);vm.runInContext(source,local);
  local.startLocalStream(); await local.updateLive();
  callbacks.get("snapshot")({data:JSON.stringify({status:"live",records:rows(now),checked_at:now,next_check:now+15000})});
  assert.equal(opened,1);assert.equal(requests,0);
  assert.equal(local.document.getElementById("sampleTotal").textContent,"100");
});

