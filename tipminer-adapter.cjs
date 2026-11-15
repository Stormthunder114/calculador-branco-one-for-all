"use strict";

/**
 * Adaptador de dados (offline) para o formato TipMiner Blitz4 Double.
 * NAO realiza requisicoes nem assina SSE: uso de API de terceiros requer
 * autorizacao por escrito, conforme os termos do provedor.
 *
 * Contrato informado pelo usuario: uuid, type, result, instant.
 * DEFAULT = preto (2), DOUBLE = amarelo (1), LUCKY = branco (0).
 */
const COLORS = Object.freeze({DEFAULT:2, DOUBLE:1, LUCKY:0});
const LABELS = Object.freeze({DEFAULT:"preto",DOUBLE:"amarelo",LUCKY:"branco"});

function parseInstant(value) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const date=Date.parse(value);
  return Number.isFinite(date)?date:null;
}
function numericRoll(value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d{1,2}$/.test(value))) return null;
  const n=Number(value);
  return Number.isInteger(n) && n>=0 && n<=14 ? n : null;
}
function normalizeTipMinerRound(raw,now=Date.now()) {
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) return null;
  if (typeof raw.uuid!=="string" || !raw.uuid.trim() || raw.uuid.length>128) return null;
  const type=typeof raw.type==="string" ? raw.type.toUpperCase() : "";
  if (!Object.prototype.hasOwnProperty.call(COLORS,type)) return null;
  const t=parseInstant(raw.instant);
  if (t===null || t>now+120000) return null;
  const color=COLORS[type];
  const roll=numericRoll(raw.result);
  // Se o campo result contiver um numero, nao aceitar cor contraditoria.
  if (roll!==null && color !== (roll===0?0:roll<=7?1:2)) return null;
  return {
    id:"tipminer:"+raw.uuid.trim(),t,c:color,roll,
    source:"TipMiner Blitz4 Double",type,label:LABELS[type]
  };
}
function normalizeTipMinerHistory(payload,now=Date.now()) {
  // O formato do envelope ainda nao foi verificado em resposta real.
  // Aceita lista diretamente ou objeto que exponha campo history/records.
  const values=Array.isArray(payload)?payload:
    Array.isArray(payload?.history)?payload.history:
    Array.isArray(payload?.records)?payload.records:null;
  if (values===null) throw new Error("Envelope TipMiner nao confirmado: esperado array, history ou records.");
  const unique=new Map();
  for (const candidate of values) {
    const row=normalizeTipMinerRound(candidate,now);
    if (row) unique.set(row.id,row);
  }
  return [...unique.values()].sort((a,b)=>a.t-b.t);
}
module.exports={COLORS,LABELS,parseInstant,numericRoll,normalizeTipMinerRound,normalizeTipMinerHistory};
