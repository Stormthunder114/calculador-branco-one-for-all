"use strict";

/* One For All — somente API oficial Blitz.
   Um GET por ciclo (página 1, até 100 rodadas).
   Não utiliza dados do Históricos Blaze nem importação manual. */
const API = "https://blitz4.casino/api/singleplayer-originals/originals/roulette_games/recent/history/1";
const TIMEZONE = "America/Sao_Paulo";
const POLL_MS = 120000;
const CONTINUITY_MS = 150000;
const FRESH_MS = 300000;
const MAX_SERVER_AGE_MS = 600000;
const HOUR_MS = 3600000;
const MAX_ROUND_AGE_MS = 24 * HOUR_MS;
const MAX_ARCHIVE = 300;
const OFFICIAL_STORAGE = "ofa_apenas_blitz_live_v1";
const FIRST_TEST_TIME = Date.parse("2026-11-15T04:00:00.000Z");
const $ = id => document.getElementById(id);
const clockFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone:TIMEZONE, day:"2-digit", month:"2-digit", year:"numeric",
  hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
});
const shortTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone:TIMEZONE, hour:"2-digit", minute:"2-digit", hourCycle:"h23"
});
const labels = ["Branco", "Amarelo", "Preto"];

let latest = [];           // Só recebe resultado de consulta oficial bem-sucedida
let archive = [];          // Também exclusivamente oficial, recuperado após uma consulta válida
let state = "loading";     // loading, live, delayed, unavailable, rate-limited, denied
let reason = "Conectando à API oficial...";
let inFlight = false;
let everConnected = false;
let lastFetchedAt = 0;
let lastRequestedAt = 0;
let nextRequestAt = 0;
let blockUntil = 0;
let stopAutomatic = false;
let pollingHandle = null;
let events = [];
const localClock = new Intl.DateTimeFormat("pt-BR", {timeZone:TIMEZONE,hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});

function formatTime(timestamp) {
  return clockFormat.format(new Date(timestamp));
}
function formatHour(timestamp) {
  return shortTime.format(new Date(timestamp));
}
function buildApiUrl() {
  // O endpoint fornecido pelo usuário retorna as rodadas recentes sem filtro por datas.
  // Não adicionar startDate, endDate ou page; validar os registros e sua idade na resposta.
  return API + "?";
}
function validateRound(raw, now = Date.now()) {
  if (!raw || raw.id === undefined || raw.id === null) return null;
  const roll = Number(raw.roll), color = Number(raw.color);
  if (!Number.isInteger(roll) || roll < 0 || roll > 14 ||
      !Number.isInteger(color) || color < 0 || color > 2) return null;
  if (color !== (roll === 0 ? 0 : roll <= 7 ? 1 : 2)) return null;
  const sourceTime = String(raw.created_at || "");
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(sourceTime)) return null;
  const t = Date.parse(sourceTime);
  if (!Number.isFinite(t) || t > now+120000 || t < now-MAX_ROUND_AGE_MS-120000) return null;
  return {id:String(raw.id),t,roll,c:color};
}
function normalizeOfficial(body, now = Date.now()) {
  const rows = Array.isArray(body?.records) ? body.records :
    (Array.isArray(body?.data?.records) ? body.data.records : null);
  if (!rows) throw new Error("A API não retornou a lista esperada de rodadas.");
  if (!rows.length) throw new Error("A API retornou uma lista vazia.");
  const unique = new Map();
  for (const raw of rows.slice(0,100)) {
    const result = validateRound(raw,now);
    if (result) unique.set(result.id,result);
  }
  const results = [...unique.values()].sort((a,b)=>a.t-b.t);
  const minValid=Math.max(1,Math.ceil(Math.min(rows.length,100)*0.8));
  if (results.length < minValid) throw new Error("A resposta da API veio incompleta ou possui dados inválidos.");
  const newest = results[results.length-1];
  if (now-newest.t > MAX_SERVER_AGE_MS) {
    throw new Error("A API respondeu, mas os resultados estão antigos (última rodada " +
      formatTime(newest.t) + "). Nenhum dado será apresentado como ao vivo.");
  }
  return results;
}
function loadOfficialArchive(now = Date.now()) {
  try {
    const payload = JSON.parse(localStorage.getItem(OFFICIAL_STORAGE) || "null");
    if (!payload || payload.source !== "Blitz API oficial" || !Array.isArray(payload.records)) return [];
    const safe = payload.records.filter(r =>
      r && typeof r.id === "string" && Number.isFinite(r.t) &&
      Number.isInteger(r.roll) && Number.isInteger(r.c) &&
      r.c === (r.roll === 0 ? 0 : r.roll <= 7 ? 1 : 2) &&
      r.t >= FIRST_TEST_TIME && r.t <= now + 120000 &&
      r.t >= now-7*86400000
    );
    return safe.sort((a,b)=>a.t-b.t).slice(-MAX_ARCHIVE);
  } catch (_) { return []; }
}
function mergeOfficial(newRows, now = Date.now()) {
  const rows = new Map(archive.map(r=>[r.id,r]));
  for (const row of newRows) rows.set(row.id,row);
  archive = [...rows.values()].sort((a,b)=>a.t-b.t).slice(-MAX_ARCHIVE);
  latest = newRows.slice(-100).reverse();
  try {
    localStorage.setItem(OFFICIAL_STORAGE,JSON.stringify({
      source:"Blitz API oficial",saved_at:new Date(now).toISOString(),records:archive
    }));
  } catch (_) { /* armazenamento opcional; a página continua exibindo a coleta atual */ }
}
function hourResults(now = Date.now()) {
  const records = archive.filter(r => r.t >= FIRST_TEST_TIME && r.t <= now+120000)
    .sort((a,b)=>a.t-b.t);
  const byHour = new Map();
  records.forEach((r,index) => {
    const hour = Math.floor(r.t/HOUR_MS)*HOUR_MS;
    if (!byHour.has(hour)) byHour.set(hour,[]);
    byHour.get(hour).push({...r,index});
  });
  const outcomes = [];
  for (const [hour,rows] of byHour) {
    const item = {hour,status:"incompleto",trigger:null,attempt:null,examined:0};
    if (!rows.length || rows[0].t > hour+CONTINUITY_MS) {
      outcomes.push(item); continue;
    }
    let triggerIndex = -1;
    let gap = false;
    for (let j=1; j<rows.length; j++) {
      if (rows[j].t<=rows[j-1].t || rows[j].t-rows[j-1].t>CONTINUITY_MS) {
        gap = true; break;
      }
      if (rows[j-1].c===1 && rows[j].c===1) {
        triggerIndex=j; break;
      }
    }
    if (gap) {outcomes.push(item);continue;}
    if (triggerIndex<0) {
      const last = rows[rows.length-1];
      const fullHour = now>=hour+HOUR_MS && last.t>=hour+HOUR_MS-CONTINUITY_MS;
      item.status = fullHour ? "sem-par" :
        (now-last.t < CONTINUITY_MS ? "observando" : "incompleto");
      outcomes.push(item);continue;
    }
    const trigger = rows[triggerIndex];
    item.trigger=trigger.t;
    item.status="pendente";
    let previous=trigger;
    for(let attempt=1;attempt<=11;attempt++) {
      const next=records[trigger.index+attempt];
      if (!next) {
        item.status=now-previous.t<=CONTINUITY_MS?"pendente":"incompleto";
        break;
      }
      if (next.t<=previous.t || next.t-previous.t>CONTINUITY_MS) {
        item.status="incompleto";break;
      }
      item.examined=attempt;
      if (next.c===0) {
        item.status="acerto";item.attempt=attempt;break;
      }
      if (attempt===11) item.status="falha";
      previous=next;
    }
    outcomes.push(item);
  }
  return outcomes.sort((a,b)=>b.hour-a.hour);
}
function renderClock() {
  if ($("liveClock")) $("liveClock").textContent=localClock.format(new Date())+" BRT";
}
function safeHTML(x) {
  return String(x).replace(/[&<>"']/g,k=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[k]));
}
function logEvent(message,type="info") {
  if (events[0]?.message===message) return;
  events.unshift({time:Date.now(),message,type});
  events=events.slice(0,8);
  const el=$("eventList");
  if (el) el.innerHTML=events.map(e=>'<div class="log-entry '+safeHTML(e.type)+'"><span>'+
    formatTime(e.time)+'</span><p>'+safeHTML(e.message)+'</p></div>').join("");
}
function whiteIntervalStats(list) {
  const data=[...list].sort((a,b)=>a.t-b.t),positions=[],gaps=[];
  data.forEach((x,i)=>{if(x.c===0)positions.push(i)});
  for(let k=1;k<positions.length;k++){
    const a=positions[k-1],b=positions[k];
    let complete=true;
    for(let j=a+1;j<=b;j++){
      const interval=data[j].t-data[j-1].t;
      if(interval>CONTINUITY_MS||interval<=0){complete=false;break}
    }
    if(complete)gaps.push(b-a-1);
  }
  return {
    whites:positions.length, intervals:gaps.length,
    mean:gaps.length?gaps.reduce((a,b)=>a+b,0)/gaps.length:null,
    max:gaps.length?Math.max(...gaps):null
  };
}
function renderArchive() {
  const sum=whiteIntervalStats(archive);
  $("archiveCount").textContent=archive.length+" / "+MAX_ARCHIVE;
  $("archiveWhites").textContent=archive.length?String(sum.whites):"—";
  $("archiveMeanGap").textContent=sum.mean===null?"—":sum.mean.toFixed(1).replace(".",",")+" rodadas";
  $("archiveMaxGap").textContent=sum.max===null?"—":sum.max+" rodadas";
  if (!archive.length) {
    $("archiveDescription").textContent="Os resultados oficiais só são armazenados após uma consulta válida.";
    $("archiveRounds").textContent="Nenhum histórico oficial disponível neste navegador.";
  } else {
    $("archiveDescription").textContent="Histórico neste navegador, não ao vivo · última "+
      formatTime(archive[archive.length-1].t)+".";
    $("archiveRounds").innerHTML=[...archive].reverse().map(roundMarkup).join("");
  }
}
function showConnectionDetail(text) {
  const field = $("requestInfo");
  if (field) field.textContent = text;
}
function setStatus(type,message) {
  if (state!==type || reason!==message) logEvent(message,type);
  state=type;
  reason=message;
  renderStatus();
}
function renderStatus() {
  const dot=$("statusDot"),badge=$("statusBadge"),notice=$("notice");
  dot.className="status-dot "+state;
  badge.textContent={
    loading:"Conectando...",live:"Conectado à Blitz",delayed:"Dados atrasados",
    unavailable:"Conexão indisponível", "rate-limited":"Aguardando liberação",
    denied:"Acesso não autorizado"
  }[state] || "Indisponível";
  notice.className="notice "+(["live"].includes(state)?"success":"loading"===state?"neutral":"warn");
  notice.textContent=reason;
  renderLastResult();
  renderSchedule();
}
function renderLastResult() {
  const el=$("lastResult"),detail=$("lastResultDetails");
  if (!latest.length) {
    el.textContent="Sem resultados atuais";
    detail.textContent="Não exibimos dados de fontes externas nem registros antigos.";
    return;
  }
  const r=latest[0],age=Date.now()-r.t;
  el.textContent=formatTime(r.t);
  detail.textContent="Último número: "+r.roll+" · "+labels[r.c]+
    (age>FRESH_MS?" · Atenção: resultados desatualizados.":" · Fonte oficial.");
}
function renderSchedule() {
  const el=$("nextUpdate"),button=$("refreshBtn");
  $("lastChecked").textContent=lastRequestedAt?formatTime(lastRequestedAt):"Ainda não realizada";
  if (inFlight) {
    el.textContent="Recebendo a primeira página (até 100 rodadas)...";
    button.disabled=true;
    button.textContent="Atualizando...";
    return;
  }
  if (stopAutomatic) {
    el.textContent=state==="denied" ?
      "Servidor recusou a consulta. A coleta foi suspensa." :
      "Não foi possível ler a resposta (CORS ou rede). Coleta suspensa para evitar repetição.";
    button.disabled=true;
    button.textContent=state==="denied"?"Acesso recusado":"Não foi possível conectar";
    return;
  }
  if (Date.now()<blockUntil) {
    el.textContent="Nova tentativa não antes de "+formatTime(blockUntil)+".";
    button.disabled=true;
    button.textContent="Aguardando intervalo";
    return;
  }
  button.disabled=false;
  button.textContent="Atualizar agora";
  const remaining=Math.max(0,nextRequestAt-Date.now());
  const seconds=Math.ceil(remaining/1000);
  el.textContent=everConnected&&remaining>0?
    "Próxima consulta em "+Math.floor(seconds/60)+"min "+String(seconds%60).padStart(2,"0")+"s · aba ativa.":
    "Atualização automática aproximadamente a cada 2 minutos, com a aba ativa.";
}
function roundMarkup(row) {
  return '<span class="round c'+row.c+'" title="'+formatTime(row.t)+
    ' · '+labels[row.c]+'" aria-label="'+row.roll+' '+labels[row.c]+' às '+
    formatTime(row.t)+'">'+row.roll+'</span>';
}
function renderRounds() {
  const container=$("rounds");
  if (!latest.length || Date.now()-latest[0].t>FRESH_MS) {
    container.className="rounds empty-rounds";
    container.textContent=latest.length?"A última amostra ficou antiga. Consulte o histórico salvo abaixo.":
      "Nenhum resultado oficial disponível no momento.";
    return;
  }
  container.className="rounds";
  container.innerHTML=latest.map(roundMarkup).join("");
}
function renderStatistics() {
  const counts=[0,0,0];
  latest.forEach(r=>{counts[r.c]++;});
  $("sampleTotal").textContent=latest.length?String(latest.length):"—";
  ["White","Yellow","Black"].forEach((name,i)=>{
    $("count"+name).textContent=latest.length?String(counts[i]):"—";
    $("pct"+name).textContent=latest.length?
      (counts[i]*100/latest.length).toFixed(1).replace(".",",")+"% das rodadas":"Na amostra";
    const bar=$("bar"+name);
    if (bar?.style) bar.style.width=(latest.length?counts[i]*100/latest.length:0)+"%";
  });
  $("sampleDescription").textContent=latest.length?
    latest.length+" rodadas oficiais · Última: "+formatTime(latest[0].t)+
    (Date.now()-latest[0].t<=FRESH_MS?" · Amostra recente.":" · AMOSTRA ANTIGA, não é ao vivo."):
    "Aguardando resposta da API oficial.";
}
function renderExperiments() {
  const outcomes=hourResults();
  const completed=outcomes.filter(x=>x.status==="acerto"||x.status==="falha");
  const hits=completed.filter(x=>x.status==="acerto").length;
  $("signalTotal").textContent=String(completed.length);
  $("signalHits").textContent=String(hits);
  $("signalMisses").textContent=String(completed.length-hits);
  $("signalRate").textContent=completed.length?
    (100*hits/completed.length).toFixed(1).replace(".",",")+"%":"—";
  const strings={
    "acerto":"Branco encontrado","falha":"Sem branco","pendente":"Acompanhando",
    "observando":"Aguardando par","sem-par":"Sem par","incompleto":"Dados incompletos"
  };
  $("historyRows").innerHTML=outcomes.slice(0,24).map(x=>{
    const attempts=x.status==="acerto" ? x.attempt+"/11" :
      x.status==="falha" ? "11/11":
      x.status==="pendente" ? x.examined+"/11":"—";
    return '<tr><td>'+formatTime(x.hour)+'</td><td>'+
      (x.trigger===null?"—":formatHour(x.trigger))+'</td><td><span class="result-status '+
      x.status+'">'+strings[x.status]+'</span></td><td>'+attempts+'</td></tr>';
  }).join("")||'<tr><td class="empty" colspan="4">Sem rodadas oficiais suficientes para avaliar uma hora.</td></tr>';
}
function render() {
  renderClock();
  renderRounds();
  renderStatistics();
  renderArchive();
  renderExperiments();
  renderStatus();
}
function retryAfter(response,now) {
  const header=response.headers?.get?.("Retry-After");
  if (!header) return now+30*60000;
  const seconds=Number(header);
  let ms=Number.isFinite(seconds) && seconds>=0?seconds*1000:Date.parse(header)-now;
  if (!Number.isFinite(ms)) ms=30*60000;
  return now+Math.max(30*60000,Math.min(ms,86400000));
}
async function updateLive() {
  if (inFlight || stopAutomatic || Date.now()<blockUntil) return;
  if (lastRequestedAt && Date.now()-lastRequestedAt<POLL_MS) return;
  if (typeof document !== "undefined" && document.hidden) return;
  inFlight=true;
  setStatus("loading","Consultando o endereço oficial da Blitz sem parâmetros...");
  showConnectionDetail("Requisição iniciada: " + formatTime(Date.now()) + ". Aguardando resposta da API.");
  let controller=null,timeout=null;
  try {
    controller=typeof AbortController!=="undefined" ? new AbortController():null;
    if (controller) timeout=setTimeout(()=>controller.abort(),15000);
    const requestedAt=Date.now();
    lastRequestedAt=requestedAt;
    const response=await fetch(buildApiUrl(requestedAt),{
      method:"GET",mode:"cors",credentials:"omit",cache:"no-store",
      ...(controller ? {signal:controller.signal}: {})
    });
    showConnectionDetail("Resposta HTTP " + response.status + " recebida da API oficial.");
    if (response.status===429) {
      blockUntil=retryAfter(response,Date.now());
      setStatus("rate-limited","A Blitz limitou as consultas (HTTP 429). Respeitaremos o intervalo solicitado.");
      return;
    }
    if ([401,403,451].includes(response.status)) {
      stopAutomatic=true;
      setStatus("denied","A Blitz respondeu HTTP "+response.status+
        ". A coleta automática foi suspensa; não tentaremos contornar esse bloqueio.");
      return;
    }
    if (!response.ok) {
      blockUntil=Date.now()+10*60000;
      setStatus("unavailable","A API respondeu HTTP "+response.status+
        ". Tentaremos novamente após um intervalo.");
      return;
    }
    const body=await response.json();
    const parsed=normalizeOfficial(body,Date.now());
    if (!everConnected) archive=loadOfficialArchive(Date.now());
    mergeOfficial(parsed,Date.now());
    everConnected=true;
    lastFetchedAt=Date.now();
    showConnectionDetail("Sucesso: HTTP 200; " + parsed.length +
      " rodadas verificadas. Recebido em " + formatTime(Date.now()) + ".");
    const age=Date.now()-latest[0].t;
    setStatus(age<=FRESH_MS?"live":"delayed",
      age<=FRESH_MS?
        "Conexão direta com a API oficial confirmada. "+latest.length+
        " rodadas recebidas; atualização automática ativa.":
        "A API respondeu, mas a última rodada tem mais de 5 minutos. Não são resultados em tempo real.");
    render();
  } catch (error) {
    if (error instanceof SyntaxError) {
      blockUntil=Date.now()+10*60000;
      setStatus("unavailable","A API não retornou JSON válido. Nenhum dado foi substituído.");
    } else if (error?.message?.includes("resultados estão antigos") ||
               error?.message?.includes("incompleta") ||
               error?.message?.includes("lista")) {
      blockUntil=Date.now()+10*60000;
      setStatus("delayed",error.message);
    } else {
      // Sem resposta HTTP acessível não é possível distinguir CORS de rede.
      showConnectionDetail("O navegador não disponibilizou um status HTTP. Isso pode indicar CORS " +
        "ou falha de rede. O fato de a mesma URL abrir em outra aba não autoriza a leitura pelo GitHub Pages.");
      stopAutomatic=true;
      setStatus("unavailable",
        "O navegador não conseguiu ler a resposta da Blitz. Pode ser CORS ou falha de rede. "+
        "A consulta automática foi suspensa para não repetir requisições bloqueadas.");
    }
  } finally {
    if (timeout!==null) clearTimeout(timeout);
    inFlight=false;
    if (everConnected) render();
    renderStatus();
    schedulePoll();
  }
}
function schedulePoll() {
  if (pollingHandle!==null) clearTimeout(pollingHandle);
  pollingHandle=null;
  if (stopAutomatic) return;
  const wait=Math.max(POLL_MS,blockUntil-Date.now());
  nextRequestAt=Date.now()+wait;
  pollingHandle=setTimeout(()=>{
    pollingHandle=null;
    if (typeof document!=="undefined" && document.hidden) {
      schedulePoll();
    } else {
      updateLive();
    }
  },wait);
}
function onRefreshClick() {
  if (!inFlight && !stopAutomatic && Date.now()>=blockUntil) updateLive();
}
$("refreshBtn").addEventListener("click",onRefreshClick);
$("requestedUrl").textContent=buildApiUrl();
$("apiLink").href=buildApiUrl();
$("apiInfoLink").href=buildApiUrl();
document.addEventListener("visibilitychange",()=>{
  if (!document.hidden && !inFlight && !stopAutomatic && Date.now()>=nextRequestAt) {
    updateLive();
  }
});
setInterval(()=>{
  if (everConnected && latest.length) {
    const age=Date.now()-latest[0].t;
    if (age>FRESH_MS && state==="live") {
      setStatus("delayed","A última rodada recebida já está desatualizada. Aguardando nova resposta oficial.");
    }
  }
  renderClock();
  renderLastResult();
  renderSchedule();
  renderRounds();
  renderStatistics();
},30000);
render();
logEvent("Painel iniciado; aguardando consulta à API oficial.","info");
if (typeof window !== "undefined") updateLive();
