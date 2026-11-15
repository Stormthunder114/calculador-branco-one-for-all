"use strict";

/* ONE FOR ALL | Observatório Blitz
   Nunca gera previsões nem horários de apostas.
   Regras fixadas em 15/11/2026, sem ajuste após observar dados. */
const CUTOFF_ISO = "2026-11-15T04:00:00.000Z"; // 15/11/2026 01h, Brasília
const CUTOFF = Date.parse(CUTOFF_ISO);
const HOUR = 3600000;
const MAX_GAP = 150000;
const COOLDOWN = 10 * 60000;
const STORE = "ofa_blitz_records_v2";
const MANUAL_STORE = "ofa_blitz_treino_v2";
const LIMIT_STORE = 7500;
const $ = (id) => document.getElementById(id);
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
  year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
const hourFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});
let records = readStorage(STORE, []);
let training = readStorage(MANUAL_STORE, []);
let updating = false;
let nextAllowed = Number(localStorage.getItem("ofa_feed_next_allowed_v3") || 0);

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return Array.isArray(value) ? value : fallback;
  } catch (_) { return fallback; }
}
function tell(message, kind) {
  const el = $("notice");
  el.textContent = message;
  el.className = "notice " + (kind || "normal");
}
function sanitizeRecord(raw) {
  if (!raw || raw.id === null || raw.id === undefined) return null;
  const color = Number(raw.color);
  if (![0, 1, 2].includes(color)) return null;
  const originalTime = String(raw.created_at || "");
  const timeString = /(?:Z|[+-]\d{2}:\d{2})$/i.test(originalTime) ? originalTime : originalTime + "Z";
  const time = Date.parse(timeString);
  if (!Number.isFinite(time) || time < CUTOFF || time > Date.now() + 120000) return null;
  return { id: String(raw.id), t: time, c: color, roll: raw.roll };
}
function mergeRecords(input) {
  const map = new Map(records.filter(r => r && r.id).map(r => [r.id, r]));
  let received = 0;
  for (const raw of input) {
    const row = sanitizeRecord(raw);
    if (!row) continue;
    if (!map.has(row.id)) received++;
    map.set(row.id, row);
  }
  records = [...map.values()].sort((a,b) => a.t - b.t).slice(-LIMIT_STORE);
  try { localStorage.setItem(STORE, JSON.stringify(records)); }
  catch (_) { tell("Não foi possível salvar todas as rodadas neste navegador.", "warn"); }
  return received;
}
function gapBefore(list, index) {
  return index > 0 && (list[index].t - list[index - 1].t > MAX_GAP ||
    list[index].t <= list[index - 1].t);
}
function groupHours() {
  const ordered = records.filter(r => r && Number.isFinite(r.t) && [0,1,2].includes(r.c))
    .sort((a,b) => a.t - b.t);
  const hours = new Map();
  ordered.forEach((r,i) => {
    if (r.t < CUTOFF) return;
    const hourStart = Math.floor(r.t / HOUR) * HOUR;
    if (!hours.has(hourStart)) hours.set(hourStart, []);
    hours.get(hourStart).push({ ...r, globalIndex: i });
  });

  const now = Date.now();
  const outcomes = [];
  for (const [start, rows] of hours) {
    const result = { start, state: "incompleto", trigger: null, attempt: null, examined: 0 };
    // Uma primeira rodada tardia pode esconder um par anterior.
    if (!rows.length || rows[0].t > start + MAX_GAP) {
      outcomes.push(result); continue;
    }
    let hole = false, second = -1;
    for (let j = 1; j < rows.length; j++) {
      if (gapBefore(rows,j)) { hole = true; break; }
      if (rows[j-1].c === 1 && rows[j].c === 1) { second = j; break; }
    }
    if (hole) { outcomes.push(result); continue; }

    if (second < 0) {
      const last = rows[rows.length-1];
      const fullHour = now >= start + HOUR &&
        last.t >= start + HOUR - MAX_GAP;
      result.state = fullHour ? "sem-sinal" : (last.t >= now - MAX_GAP ? "aguardando" : "incompleto");
      outcomes.push(result);
      continue;
    }

    const trigger = rows[second];
    result.trigger = trigger.t;
    result.state = "pendente";
    let previous = trigger;
    for (let attempt = 1; attempt <= 11; attempt++) {
      const next = ordered[trigger.globalIndex + attempt];
      if (!next) {
        result.state = previous.t >= now - MAX_GAP ? "pendente" : "incompleto";
        break;
      }
      if (next.t - previous.t > MAX_GAP || next.t <= previous.t) {
        result.state = "incompleto";
        break;
      }
      result.examined = attempt;
      if (next.c === 0) {
        result.state = "acerto";
        result.attempt = attempt;
        break;
      }
      previous = next;
      if (attempt === 11) result.state = "falha";
    }
    outcomes.push(result);
  }
  return outcomes.sort((a,b) => b.start - a.start);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);
}
function fmt(t) { return dateFormatter.format(new Date(t)); }
function hm(t) { return hourFormatter.format(new Date(t)); }
function ballsHTML(list) {
  return list.map(r => '<span class="ball c' + r.c + '" title="' +
    escapeHtml(fmt(r.t)) + '" aria-label="' + escapeHtml((["Branco", "Amarelo", "Preto"][r.c] || "") + " às " + fmt(r.t)) +
    '">' + (Number.isInteger(Number(r.roll)) && Number(r.roll) >= 0 && Number(r.roll) <= 14 ? Number(r.roll) : (r.c === 0 ? "0" : "")) + "</span>").join("");
}

let replayPos = null;
function renderSample() {
  const take = Number($("sampleCount").value || 200);
  const selectedColor = $("sampleColor").value || "all";
  const sample = records.slice(-Math.min(200,Math.max(50,take))).reverse();
  const counts = [0,0,0];
  for (const row of sample) counts[row.c]++;
  const labels = ["sampleWhite", "sampleYellow", "sampleBlack"];
  labels.forEach((id,c) => {
    $(id).textContent = sample.length ? counts[c] + " (" + (100*counts[c]/sample.length).toFixed(1).replace(".",",") + "%)" : "0";
  });
  const visible = selectedColor === "all" ? sample : sample.filter(r => r.c === Number(selectedColor));
  $("sampleSummary").textContent = sample.length ?
    sample.length + " rodadas salvas nesta amostra; " + visible.length + " exibidas após o filtro. A amostra é histórica, não preditiva." :
    "Ainda não há dados coletados. O filtro não altera o cálculo dos sinais.";
  $("recentBalls").innerHTML = ballsHTML(visible);
  if (!sample.length) $("recentBalls").textContent = "Nenhuma rodada recebida. Você pode usar a análise de números mais abaixo.";
  else if (!visible.length) $("recentBalls").textContent = "Nenhuma rodada dessa cor na amostra.";
}
function renderReplay() {
  const sample = records.slice(-200);
  if (replayPos === null || (replayPos === 0 && sample.length > 0) || replayPos > sample.length) replayPos = sample.length;
  const slider = $("replayPosition");
  slider.max = String(sample.length || 1);
  slider.min = "1";
  slider.disabled = !sample.length;
  slider.value = String(Math.max(1,replayPos));
  if (!sample.length) {
    $("replayState").textContent = "Nenhuma rodada recebida para o replay.";
    $("replayBalls").textContent = "";
    return;
  }
  const row = sample[Math.max(1,replayPos) - 1];
  $("replayState").textContent = "Rodada " + replayPos + "/" + sample.length +
    " · " + fmt(row.t) + " · " + ["Branco","Amarelo","Preto"][row.c];
  $("replayBalls").innerHTML = ballsHTML(sample.slice(Math.max(0,replayPos-29),replayPos));
}
function parsePastedNumbers(text) {
  const matches = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^Image:\s*/i,"");
    if (!line) continue;
    if (/^branco$/i.test(line)) { matches.push(0); continue; }
    if (/^(?:0|[1-9]|1[0-4])$/.test(line)) {
      matches.push(Number(line));
      continue;
    }
    if (/^(?:(?:0|[1-9]|1[0-4])(?:[\s,;|]+|$))+$/.test(line)) {
      matches.push(...line.split(/[\s,;|]+/).filter(Boolean).map(Number));
    }
  }
  return matches.slice(0,500);
}
function analyzePasted() {
  let nums = parsePastedNumbers($("pasteRolls").value);
  if ($("pasteOrder").value !== "old") nums = nums.reverse();
  if (!nums.length) {
    $("pasteResult").textContent = "Cole números de 0 a 14, separados por espaço, vírgula ou linha.";
    $("pasteBalls").innerHTML = "";
    return;
  }
  const colors = nums.map(n => n === 0 ? 0 : n <= 7 ? 1 : 2);
  const pseudo = nums.slice(-45).map((roll,i) => ({ c: colors[colors.length-Math.min(nums.length,45)+i], roll, t: Date.now() }));
  $("pasteBalls").innerHTML = pseudo.map(r => '<span class="ball c' + r.c + '">' + r.roll + '</span>').join("");
  const index = colors.findIndex((c,i) => i > 0 && colors[i-1] === 1 && c === 1);
  if (index < 0) {
    $("pasteResult").textContent = nums.length + " números analisados. Não apareceu um par consecutivo da cor 1–7 neste recorte.";
    return;
  }
  const after = colors.slice(index+1,index+12);
  const hit = after.indexOf(0);
  const outcome = hit >= 0 ? "Branco encontrado na tentativa " + (hit+1) + "/11." :
    after.length < 11 ? "Sequência incompleta: " + after.length + "/11 rodadas após o par." :
    "11 rodadas sem branco após o primeiro par.";
  $("pasteResult").textContent = nums.length + " números analisados. " + outcome +
    " É uma análise do recorte colado, sem validação da primeira ocorrência por hora.";
}
function render() {
  const outcomes = groupHours();
  const certified = outcomes.filter(x => x.state === "acerto" || x.state === "falha");
  const hits = certified.filter(x => x.state === "acerto").length;
  const misses = certified.length - hits;
  $("newTests").textContent = String(certified.length);
  $("newHits").textContent = String(hits);
  $("newMisses").textContent = String(misses);
  $("combined").textContent = (100 * (3 + hits) / (5 + certified.length)).toFixed(1).replace(".", ",") + "%";
  $("newRate").textContent = certified.length ?
    (100 * hits / certified.length).toFixed(1).replace(".", ",") + "%" : "—";
  $("rowsCount").textContent = records.length.toLocaleString("pt-BR") + " rodadas armazenadas";
  const last = records[records.length-1];
  $("lastRound").textContent = last ? "Última rodada recebida: " + fmt(last.t) : "Nenhuma rodada recebida";
  renderSample();
  renderReplay();

  const nowStart = Math.floor(Date.now() / HOUR) * HOUR;
  const current = outcomes.find(x => x.start === nowStart);
  const currentLabel = $("currentState");
  const currentDetail = $("currentDetail");
  if (!current) {
    currentLabel.textContent = "Aguardando dados desta hora";
    currentDetail.textContent = "Clique em Atualizar para tentar buscar as rodadas reais.";
  } else if (current.state === "acerto") {
    currentLabel.textContent = "Branco observado";
    currentDetail.textContent = "Apareceu na tentativa " + current.attempt + " de 11 após o par amarelo.";
  } else if (current.state === "falha") {
    currentLabel.textContent = "11 rodadas sem branco";
    currentDetail.textContent = "Falha registrada para esta hora.";
  } else if (current.trigger !== null) {
    currentLabel.textContent = current.state === "pendente" ?
      "Par amarelo encontrado" : "Dados incompletos";
    currentDetail.textContent = current.state === "pendente" ?
      "Observadas " + current.examined + " das 11 rodadas após " + hm(current.trigger) + "." :
      "Há uma lacuna nos registros; não é possível validar o sinal.";
  } else {
    currentLabel.textContent = current.state === "aguardando" ?
      "Aguardando dois amarelos" : "Dados incompletos nesta hora";
    currentDetail.textContent = current.state === "aguardando" ?
      "Nenhum par confirmado na sequência coletada desta hora." :
      "Precisamos da sequência desde o começo da hora para validar o primeiro par.";
  }

  const labels = {
    "acerto": "Branco", "falha": "Falha", "pendente": "Em observação",
    "sem-sinal": "Sem par amarelo", "aguardando": "Aguardando", "incompleto": "Dados incompletos"
  };
  $("historyBody").innerHTML = outcomes.slice(0,36).map(x => {
    const text = x.state === "acerto" ? "Tentativa " + x.attempt + "/11" :
      x.state === "falha" ? "11/11" :
      x.state === "pendente" ? x.examined + "/11 rodadas" : "—";
    return '<tr><td>' + escapeHtml(fmt(x.start)) + '</td><td>' +
      (x.trigger !== null ? escapeHtml(hm(x.trigger)) : "—") +
      '</td><td><span class="state s-' + x.state + '">' + labels[x.state] +
      '</span></td><td>' + text + '</td></tr>';
  }).join("") || '<tr><td colspan="4" class="empty">Ainda não há horas com registros.</td></tr>';
  renderTraining();
  refreshCooldown();
}
function refreshCooldown() {
  const remaining = nextAllowed - Date.now();
  $("updateBtn").disabled = updating || remaining > 0;
  if (!updating) {
    $("updateBtn").textContent = remaining > 0 ?
      "Atualizado · recarregar às " + hm(nextAllowed) : "Atualizar resultados";
  }
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function updateData() {
  if (updating || Date.now() < nextAllowed) return;
  updating = true;
  nextAllowed = Date.now() + 2 * 60000; // arquivo público do próprio site, não consulta a fonte externa
  localStorage.setItem("ofa_feed_next_allowed_v3", String(nextAllowed));
  $("updateBtn").textContent = "Carregando histórico...";
  $("updateBtn").disabled = true;
  try {
    const feeds = [
      "https://raw.githubusercontent.com/Stormthunder114/calculador-branco-one-for-all/main/data/blitz-historico-publico.json",
      "./data/blitz-historico-publico.json"
    ];
    let feed = null;
    for (const base of feeds) {
      try {
        const response = await fetch(base + "?rev=" + Date.now(), {
          method: "GET", cache: "no-store", credentials: "omit"
        });
        if (!response.ok) continue;
        const candidate = await response.json();
        if (candidate?.source === "Históricos Blaze" && Array.isArray(candidate.records)) {
          feed = candidate;
          break;
        }
      } catch (_) { /* tenta segunda origem, sem repetir contato com o Históricos Blaze */ }
    }
    if (!feed) throw new Error("Ainda não foi possível carregar o histórico publicado pelo GitHub.");
    if (!feed || feed.source !== "Históricos Blaze" || !Array.isArray(feed.records)) {
      throw new Error("O arquivo de histórico está em formato inesperado.");
    }
    const fetched = Date.parse(feed.fetched_at || "");
    if (!Number.isFinite(fetched) || fetched > Date.now()+120000) {
      throw new Error("Não foi possível conferir o horário de atualização da fonte.");
    }
    const count = mergeRecords(feed.records);
    render();
    const age = Date.now() - fetched;
    const sourceTime = fmt(fetched);
    if (age > 2 * HOUR) {
      tell("O histórico externo está atrasado (última coleta " + sourceTime +
        "). " + count + " rodadas novas recuperadas. Não considere este painel ao vivo.", "warn");
    } else {
      tell("Histórico atualizado pelo GitHub: " + count + " rodadas novas. Fonte: Históricos Blaze. Última coleta: " + sourceTime + ". A fonte pode ter lacunas.", "ok");
    }
  } catch (err) {
    tell((err instanceof Error ? err.message : "Falha ao buscar resultados") +
      " Os dados já armazenados continuam no navegador.", "warn");
  } finally {
    updating = false;
    refreshCooldown();
  }
}
function trainingState() {
  let trigger = -1;
  for (let i=1; i<training.length; i++) {
    if (training[i-1] === 1 && training[i] === 1) { trigger=i; break; }
  }
  if (trigger < 0) return { state:"waiting", count:0 };
  const following = training.slice(trigger + 1, trigger + 12);
  const white = following.indexOf(0);
  if (white >= 0) return {state:"hit",count:white+1};
  if (following.length === 11) return {state:"miss",count:11};
  return {state:"watching",count:following.length};
}
function renderTraining() {
  const state = trainingState();
  const messages = {
    waiting:"Aguardando dois amarelos consecutivos.",
    watching:"Par encontrado. Rodadas seguintes: " + state.count + "/11.",
    hit:"Branco na tentativa " + state.count + "/11. Encerrou!",
    miss:"11 rodadas sem branco. Encerrou!"
  };
  $("trainingState").textContent = messages[state.state];
  $("trainingBalls").innerHTML = training.map(c =>
    '<span class="ball c' + c + '">' + (c === 0 ? "0" : "") + "</span>").join("");
  for (const id of ["whiteBtn","yellowBtn","blackBtn"]) $(id).disabled =
    state.state === "hit" || state.state === "miss";
}
function addTraining(color) {
  if (["hit","miss"].includes(trainingState().state)) return;
  if (training.length >= 100) { tell("Reinicie o treino para continuar.", "warn"); return; }
  training.push(color);
  localStorage.setItem(MANUAL_STORE, JSON.stringify(training));
  renderTraining();
}
function exportCopy() {
  const snapshot = {
    version:2, exported_at:new Date().toISOString(), observations:records,
    legacy_validation:{signals:5,hits:3,misses:2,white_attempts:[7,8,10]},
    note:"Estudo estatístico, não uma ferramenta de previsão."
  };
  const blob = new Blob([JSON.stringify(snapshot,null,2)],{type:"application/json"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "one-for-all-historico-" + new Date().toISOString().slice(0,10) + ".json";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href),1000);
}
$("sampleCount").addEventListener("change", renderSample);
$("sampleColor").addEventListener("change", renderSample);
$("replayPosition").addEventListener("input", value => {
  replayPos = Number($("replayPosition").value);
  renderReplay();
});
$("pasteAnalyzeBtn").addEventListener("click", analyzePasted);
$("updateBtn").addEventListener("click", updateData);
$("whiteBtn").addEventListener("click", () => addTraining(0));
$("yellowBtn").addEventListener("click", () => addTraining(1));
$("blackBtn").addEventListener("click", () => addTraining(2));
$("resetTraining").addEventListener("click", () => {
  training = []; localStorage.removeItem(MANUAL_STORE); renderTraining();
});
$("exportBtn").addEventListener("click", exportCopy);
$("clearBtn").addEventListener("click", () => {
  if (!confirm("Apagar as rodadas coletadas neste navegador? O histórico anterior de 3/5 será preservado.")) return;
  records = []; localStorage.removeItem(STORE); render();
  tell("Histórico novo apagado somente deste navegador.", "normal");
});
render();
updateData(); // Na abertura, lê apenas o arquivo publicado no nosso próprio site.
setInterval(refreshCooldown, 30000);
setInterval(updateData, 10 * 60000); // O coletor na origem roda separadamente, no GitHub.
