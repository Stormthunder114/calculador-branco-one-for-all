const {test}=require("node:test");
const assert=require("node:assert/strict");
const {COLORS,normalizeTipMinerRound,normalizeTipMinerHistory}=require("../tipminer-adapter.cjs");
const NOW=Date.parse("2026-11-15T12:00:00.000Z");
const make=(type,result,uuid,instant="2026-11-15T11:59:15.000Z")=>({uuid,type,result,instant});

test("Mapeamento fornecido: DEFAULT preto; DOUBLE amarelo; LUCKY branco",()=>{
  assert.deepEqual(COLORS,{DEFAULT:2,DOUBLE:1,LUCKY:0});
  assert.equal(normalizeTipMinerRound(make("DEFAULT",12,"black"),NOW).c,2);
  assert.equal(normalizeTipMinerRound(make("DOUBLE",3,"yellow"),NOW).c,1);
  assert.equal(normalizeTipMinerRound(make("LUCKY",0,"white"),NOW).c,0);
});
test("Mantem UUID e horario em UTC sem duplicatas",()=>{
  const first=make("DOUBLE",6,"equal","2026-11-15T11:50:00.000Z");
  const newer=make("LUCKY",0,"white","2026-11-15T11:59:00.000Z");
  const rows=normalizeTipMinerHistory({history:[newer,first,first]},NOW);
  assert.equal(rows.length,2);
  assert.equal(rows[0].id,"tipminer:equal");
  assert.equal(rows[1].id,"tipminer:white");
  assert.equal(rows[1].t,Date.parse("2026-11-15T11:59:00.000Z"));
});
test("Nao inventa numero quando result nao e numerico",()=>{
  const result=normalizeTipMinerRound(make("DEFAULT","N/A","colored-only"),NOW);
  assert.equal(result.roll,null);
  assert.equal(result.c,2);
});
test("Rejeita cores incompatíveis, instante sem timezone e registros futuros",()=>{
  assert.equal(normalizeTipMinerRound(make("LUCKY",6,"bad-color"),NOW),null);
  assert.equal(normalizeTipMinerRound(make("DOUBLE",6,"no-tz","2026-11-15T11:59:00"),NOW),null);
  assert.equal(normalizeTipMinerRound(make("DEFAULT",13,"future","2026-11-15T12:10:00.000Z"),NOW),null);
});
test("Envelopes desconhecidos falham de modo explícito",()=>{
  assert.throws(()=>normalizeTipMinerHistory({data:{items:[]}},NOW),/Envelope TipMiner/);
  assert.deepEqual(normalizeTipMinerHistory([],NOW),[]);
});
test("Adaptador nao realiza requisicoes HTTP e nao invoca SSE",()=>{
  const fs=require("node:fs");
  const code=fs.readFileSync("tipminer-adapter.cjs","utf8");
  assert.doesNotMatch(code,/\bfetch\s*\(|\bEventSource\s*\(|https?:\/\//);
});
