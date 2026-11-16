const { test } = require("node:test");
const assert = require("node:assert/strict");
const Lab = require("../strategy-lab.js");

const HOUR = Date.parse("2026-11-15T05:00:00.000Z");
const records = (colors, {start=HOUR, step=30000, prefix="r"}={}) =>
  colors.map((c, i) => ({id:prefix+i,t:start+i*step,c}));

test("Base probabilística da cor = 7/15 e branco nas 11 = 1-(14/15)^11", () => {
  assert.equal(Lab.COLOR_BASELINE,7/15);
  assert.equal(Lab.WHITE_BASELINE,1-Math.pow(14/15,11));
  assert.ok(Lab.WHITE_BASELINE>0.52 && Lab.WHITE_BASELINE<0.54);
});

test("Cor oposta após a primeira trinca é medida na rodada seguinte", () => {
  const s=Lab.analyzeColor(records([2,1,1,1,2,2,2,2,2]));
  assert.equal(s.samples,2);
  assert.equal(s.hits,1);
  assert.equal(s.misses,1);
  assert.equal(s.observed,0.5);
});

test("Quarta ou quinta cor igual não cria gatilhos de trinca repetidos", () => {
  const s=Lab.analyzeColor(records([2,1,1,1,1,1,1,2]));
  assert.equal(s.samples,1);
  assert.equal(s.misses,1);
});

test("Branco após oito rodadas sem branco mede 11 próximas dentro da mesma hora", () => {
  const series=[...Array(8).fill(1),...Array(4).fill(2),0,...Array(6).fill(2)];
  const s=Lab.analyzeWhite(records(series));
  assert.equal(s.samples,1);
  assert.equal(s.hits,1);
  assert.equal(s.events[0].attempt,5);
});

test("11 rodadas sem branco conta uma falha apenas quando janela completa", () => {
  const s=Lab.analyzeWhite(records(Array(19).fill(2)));
  assert.equal(s.samples,1);
  assert.equal(s.misses,1);
});

test("Janela parcial ou com lacuna não entra como acerto nem falha", () => {
  const short=Lab.analyzeWhite(records([...Array(8).fill(1),0,2,2]));
  assert.equal(short.samples,0);
  assert.equal(short.incomplete,1);
  const gap=records([...Array(8).fill(1),0,...Array(10).fill(2)]);
  for(let i=13;i<gap.length;i++)gap[i].t+=600000;
  const broken=Lab.analyzeWhite(gap);
  assert.equal(broken.samples,0);
  assert.equal(broken.incomplete,1);
});

test("Branco na hora seguinte não é contado para hora anterior",()=>{
  const first=records([...Array(8).fill(2),...Array(8).fill(1)],{start:HOUR+50*60000,step:30000});
  const second=records([0,...Array(18).fill(2)],{start:HOUR+3600000,step:30000,prefix:"s"});
  const s=Lab.analyzeWhite([...first,...second]);
  assert.equal(s.samples,0);
  assert.equal(s.hits,0);
});

test("Último registro da trinca sem resultado seguinte não é contabilizado",()=>{
  const s=Lab.analyzeColor(records([2,1,1,1]));
  assert.equal(s.samples,0);
});

test("Lacuna no resultado seguinte da cor é inconclusiva",()=>{
  const data=records([2,1,1,1,2]);
  data[4].t+=600000;
  const s=Lab.analyzeColor(data);
  assert.equal(s.samples,0);
  assert.equal(s.incomplete,1);
});

test("Intervalo de confiança Wilson apenas com amostra válida",()=>{
  const ci=Lab.wilson95(15,30);
  assert.ok(ci[0] < 0.5 && ci[1] > 0.5);
  assert.equal(Lab.wilson95(0,0),null);
  assert.equal(Lab.analyzeColor(records([])).sufficient,false);
});

test("Deduplica ID e ignora registros inválidos",()=>{
  const data=records([2,1,1,1,2]);
  const result=Lab.validSequence([...data,data[0],{id:"bad",t:NaN,c:0}]);
  assert.equal(result.length,5);
});
