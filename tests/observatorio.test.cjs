const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('app.js', 'utf8');
const START = Date.parse('2026-11-15T04:00:00.000Z');

function harness(now = START + 60 * 60000) {
  const store = new Map();
  const elements = new Map();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = {
    Date: Clock,
    console,
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key,value) => store.set(key,String(value)),
      removeItem: key => store.delete(key),
    },
    document: { getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          textContent: '', innerHTML: '', disabled: false,
          className: '', addEventListener: () => {},
        });
      }
      return elements.get(id);
    }},
    setInterval: () => 0,
  };
  vm.createContext(context);
  vm.runInContext(source, context, {filename:'app.js'});
  return context;
}
function sequence(colors, at = START + 1000, step = 15_000) {
  return colors.map((color,index) => ({
    id: 'round-' + at + '-' + index,
    created_at: new Date(at + index * step).toISOString(),
    roll: color, color,
  }));
}
function outcome(ctx, colors, at = START + 1000, step = 15_000) {
  ctx.mergeRecords(sequence(colors, at, step));
  return ctx.groupHours().find(x => x.start === START);
}
test('branco na 7ª tentativa após o primeiro par', () => {
  const ctx = harness();
  const result = outcome(ctx, [1,1,...[2,2,2,2,2,2,0,2,2,2,2]]);
  assert.equal(result.state,'acerto');
  assert.equal(result.attempt,7);
  assert.equal(result.examined,7);
});
test('11 rodadas sem branco é falha, sem procurar outro gatilho', () => {
  const ctx = harness();
  const result = outcome(ctx,[1,1,...Array(11).fill(1),0]);
  assert.equal(result.state,'falha');
  assert.equal(result.examined,11);
});
test('a 11ª tentativa ainda conta como acerto', () => {
  const ctx = harness();
  const result = outcome(ctx,[1,1,...Array(10).fill(2),0]);
  assert.equal(result.state,'acerto');
  assert.equal(result.attempt,11);
});
test('uma janela com menos de 11 rodadas não conta como falha', () => {
  const ctx = harness(START + 2 * 60000);
  const result = outcome(ctx,[1,1,2,2,2,2]);
  assert.equal(result.state,'pendente');
  assert.equal(result.examined,4);
});
test('dados iniciados tarde não geram gatilho supostamente primeiro', () => {
  const ctx = harness();
  const result = outcome(ctx,[1,1,...Array(11).fill(2)],START + 5*60000);
  assert.equal(result.state,'incompleto');
  assert.equal(result.trigger,null);
});
test('lacuna no meio das rodadas impede classificar uma falha', () => {
  const ctx=harness();
  const rows=sequence([1,1],START+1000);
  const later=sequence(Array(11).fill(2),START+5*60000);
  ctx.mergeRecords([...rows,...later]);
  const result=ctx.groupHours().find(x=>x.start===START);
  assert.equal(result.state,'incompleto');
});
test('treino de cores não muda as estatísticas da coleta real', () => {
  const ctx = harness();
  const original=ctx.groupHours().length;
  ctx.addTraining(1);
  ctx.addTraining(1);
  for(let i=0;i<6;i++)ctx.addTraining(2);
  ctx.addTraining(0);
  assert.equal(ctx.groupHours().length,original);
  assert.equal(ctx.trainingState().state,'hit');
  assert.equal(ctx.trainingState().count,7);
});
test('duplicação da mesma rodada não aumenta o histórico', () => {
  const ctx=harness();
  const input=sequence([1,1,2]);
  assert.equal(ctx.mergeRecords(input),3);
  assert.equal(ctx.mergeRecords(input),0);
});


test('lê sequência de números e ignora horários colados do site externo', () => {
  const ctx=harness();
  const values=Array.from(ctx.parsePastedNumbers('14\n15:01\n2\n15:00\nImage: Branco\n14:59\n7'));
  assert.deepEqual(values,[14,2,0,7]);
});
test('contagens de cores de amostra de 200 são descritivas', () => {
  const ctx=harness();
  ctx.mergeRecords(sequence([0,1,2,1,0]));
  ctx.render();
  assert.match(ctx.document.getElementById('sampleWhite').textContent,/^2 \(40,0%\)/);
  assert.match(ctx.document.getElementById('sampleYellow').textContent,/^2 \(40,0%\)/);
  assert.match(ctx.document.getElementById('sampleBlack').textContent,/^1 \(20,0%\)/);
});
test('replay inicia no registro mais novo depois da primeira coleta', () => {
  const ctx=harness();
  ctx.mergeRecords(sequence([1,1,0]));
  ctx.render();
  assert.match(ctx.document.getElementById('replayState').textContent,/Rodada 3\/3/);
});
test('análise dos números colados não altera os acertos validados', () => {
  const ctx=harness();
  ctx.document.getElementById('pasteRolls').value='6 5 8 8 0';
  ctx.document.getElementById('pasteOrder').value='old';
  ctx.analyzePasted();
  assert.match(ctx.document.getElementById('pasteResult').textContent,/tentativa 3\/11/);
  assert.equal(ctx.groupHours().length,0);
});
