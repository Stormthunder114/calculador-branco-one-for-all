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
test("Só existe uma fonte, sem histórico Blaze nem importação manual",()=>{
  assert.match(JS,/blitz4\.casino\/api\/singleplayer-originals/);
  assert.doesNotMatch(JS,/historicosblaze|clipboard|parsePastedNumbers|sourceMode|pasteRolls/i);
  assert.doesNotMatch(HTML,/historicosblaze|clipboardImport|officialPaste|manualOfficialImport|testar as cores manualmente|atualizacao-automatica\.js/i);
});
test("Usa exatamente o endpoint oficial sem datas e sem parâmetros",()=>{
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
test("Rejeita número ou cor inconsistentes",()=>{
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
    assert.match(url,/page=1/);
    assert.equal(options.mode,"cors");
    assert.equal(options.credentials,"omit");
    return {status:200,ok:true,json:async()=>payload};
  };
  await ctx.updateLive();
  assert.equal(calls,1);
  assert.equal(document.getElementById("sampleTotal").textContent,"100");
  assert.equal(document.getElementById("statusBadge").textContent,"Conectado à Blitz");
  assert.match(document.getElementById("rounds").innerHTML,/class="round c/);
  const archive=JSON.parse(store.get("ofa_apenas_blitz_live_v1"));
  assert.equal(archive.source,"Blitz API oficial");
  assert.equal(archive.records.length,100);
  await ctx.updateLive();
  assert.equal(calls,1,"O botão não deve fazer consultas repetidas imediatamente");
});
test("Uma sequência contínua registra branco na tentativa 7",()=>{
  const {ctx}=harness(START+10*60000);
  const sample=singleSequence(START,[1,1,2,2,2,2,2,2,0]);
  ctx.mergeOfficial(sample,START+10*60000);
  const outcome=ctx.hourResults(START+10*60000)[0];
  assert.equal(outcome.status,"acerto");
  assert.equal(outcome.attempt,7);
});
test("11 rodadas sem branco é falha",()=>{
  const {ctx}=harness(START+10*60000);
  ctx.mergeOfficial(singleSequence(START,[1,1,...Array(11).fill(2)]),START+10*60000);
  const outcome=ctx.hourResults(START+10*60000)[0];
  assert.equal(outcome.status,"falha");
});
test("Lacuna na sequência não gera acerto nem falha",()=>{
  const {ctx}=harness(START+10*60000);
  const data=singleSequence(START,[1,1,2,2,2,2,2,2,0]);
  data.slice(3).forEach(r=>{r.t+=240000;});
  ctx.mergeOfficial(data,START+10*60000);
  assert.equal(ctx.hourResults(START+10*60000)[0].status,"incompleto");
});
test("HTTP 429 respeita o intervalo e não consulta repetidamente",async()=>{
  const {ctx,document}=harness();
  let count=0;
  ctx.fetch=async()=>({ok:false,status:429,headers:{get:()=>String(600)}});
  await ctx.updateLive();
  assert.equal(document.getElementById("statusBadge").textContent,"Aguardando liberação");
  await ctx.updateLive();
  assert.match(document.getElementById("nextUpdate").textContent,/Nova tentativa/);
});
test("HTTP 451 encerra consulta automática sem fazer nova tentativa",async()=>{
  const {ctx,document}=harness();
  let count=0;
  ctx.fetch=async()=>{count++;return {ok:false,status:451}};
  await ctx.updateLive();
  await ctx.updateLive();
  assert.equal(count,1);
  assert.equal(document.getElementById("statusBadge").textContent,"Acesso não autorizado");
  assert.equal(document.getElementById("refreshBtn").disabled,true);
});
test("Falha CORS/rede não exibe dados antigos como sucesso",async()=>{
  const {ctx,document}=harness();
  ctx.fetch=async()=>{throw new TypeError("Failed to fetch")};
  await ctx.updateLive();
  assert.equal(document.getElementById("sampleTotal").textContent,"—");
  assert.equal(document.getElementById("statusBadge").textContent,"Conexão indisponível");
  assert.match(document.getElementById("notice").textContent,/CORS/);
});
