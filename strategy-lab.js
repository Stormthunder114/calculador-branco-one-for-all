"use strict";

/*
 * ONE FOR ALL — laboratório de hipóteses (não recomenda apostas).
 * Usa apenas registros reais já validados pela aplicação.
 *
 * Cor: primeira trinca de uma mesma cor em cada sequência, verifica a
 * cor oposta SOMENTE na rodada seguinte (base teórica = 7/15).
 *
 * Branco: primeiro bloco de 8 rodadas sem branco em cada hora BRT,
 * verifica as 11 rodadas seguintes, todas NA MESMA HORA
 * (base teórica = 1 - (14/15)^11).
 *
 * Rodadas ausentes, horários inconsistentes ou janelas incompletas
 * NÃO são contados como vitória ou derrota.
 */
(function (root, make) {
  const api = make();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StrategyLab = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const CONTINUITY_MS = 150000;
  const HOUR_MS = 3600000;
  const COLOR_BASELINE = 7 / 15;
  const WHITE_BASELINE = 1 - (14 / 15) ** 11;
  const hourFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23"
  });

  function hourKey(t) {
    return hourFormatter.format(new Date(t));
  }

  function validSequence(rows) {
    const unique = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || typeof row.id !== "string" || !Number.isFinite(row.t) ||
          !Number.isInteger(row.c) || row.c < 0 || row.c > 2) continue;
      unique.set(row.id, { id: row.id, t: row.t, c: row.c });
    }
    return [...unique.values()].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  }

  function continuous(rows, from, to) {
    for (let i = from + 1; i <= to; i++) {
      if (!rows[i] || !rows[i - 1]) return false;
      const delta = rows[i].t - rows[i - 1].t;
      if (delta <= 0 || delta > CONTINUITY_MS) return false;
    }
    return true;
  }

  function wilson95(successes, total) {
    if (!Number.isInteger(successes) || !Number.isInteger(total) ||
        total < 1 || successes < 0 || successes > total) return null;
    const z = 1.96, p = successes / total, z2 = z * z;
    const d = 1 + z2 / total;
    const center = (p + z2 / (2 * total)) / d;
    const margin = (z / d) * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total));
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
  }

  function summarize(events, baseline) {
    const completed = events.filter(e => e.status === "hit" || e.status === "miss");
    const hits = completed.filter(e => e.status === "hit").length;
    return {
      samples: completed.length,
      hits, misses: completed.length - hits,
      incomplete: events.length - completed.length,
      observed: completed.length ? hits / completed.length : null,
      baseline,
      interval95: wilson95(hits, completed.length),
      sufficient: completed.length >= 30,
      events: [...events].reverse().slice(0, 12)
    };
  }

  function analyzeColor(rows) {
    const data = validSequence(rows), events = [];
    for (let i = 3; i < data.length - 1; i++) {
      const a = data[i - 2], b = data[i - 1], c = data[i], next = data[i + 1];
      if (c.c === 0 || a.c !== c.c || b.c !== c.c || !continuous(data, i - 2, i)) continue;
      // Contabiliza apenas o início da trinca, não cada quarto/quinto igual.
      if (data[i - 3].c === c.c && continuous(data, i - 3, i)) continue;
      const opposite = c.c === 1 ? 2 : 1;
      if (!continuous(data, i, i + 1)) {
        events.push({t: c.t, status: "incomplete", trigger: c.c, target: opposite, observed: null});
        continue;
      }
      events.push({
        t: c.t,
        status: next.c === opposite ? "hit" : "miss",
        trigger: c.c, target: opposite, observed: next.c
      });
    }
    return summarize(events, COLOR_BASELINE);
  }

  function analyzeWhite(rows) {
    const data = validSequence(rows), hours = new Map(), events = [];
    for (const row of data) {
      const key = hourKey(row.t);
      if (!hours.has(key)) hours.set(key, []);
      hours.get(key).push(row);
    }
    for (const [key, group] of hours.entries()) {
      if (group.length < 8) continue;
      // America/Sao_Paulo usa fronteiras de hora alinhadas a UTC.
      // Exige que a coleta tenha começado perto do início da hora,
      // evitando chamar de "primeiro gatilho" o que pode ser só um trecho.
      const hourStart = Math.floor(group[0].t / HOUR_MS) * HOUR_MS;
      if (group[0].t - hourStart > CONTINUITY_MS) continue;
      let trigger = -1;
      for (let i = 7; i < group.length; i++) {
        if (!continuous(group, 0, i)) break;
        if (group.slice(i - 7, i + 1).every(r => r.c !== 0)) {
          trigger = i; break;
        }
      }
      if (trigger === -1) continue;
      const row = group[trigger], end = trigger + 11;
      if (end >= group.length || !continuous(group, trigger, end)) {
        events.push({t: row.t, hour: key, status: "incomplete", attempt: null});
        continue;
      }
      const window = group.slice(trigger + 1, end + 1);
      const first = window.findIndex(r => r.c === 0);
      events.push({
        t: row.t, hour: key,
        status: first >= 0 ? "hit" : "miss",
        attempt: first >= 0 ? first + 1 : null
      });
    }
    return summarize(events, WHITE_BASELINE);
  }

  function analyze(rows) {
    return { color: analyzeColor(rows), white: analyzeWhite(rows) };
  }

  return {
    CONTINUITY_MS, COLOR_BASELINE, WHITE_BASELINE,
    validSequence, continuous, wilson95, analyzeColor, analyzeWhite, analyze
  };
});
