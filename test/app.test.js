const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yz-'));
process.env.SPELCODE = 'dobbel';
const { apply, validOp } = require('../public/apply.js');
const { server } = require('../server.js');

const create = { type: 'create', game: { id: 'g1', createdAt: 1, players: [{ id: 'pa', name: 'Rene' }, { id: 'pb', name: 'Anna' }] } };

test('ops replay to the same result', () => {
  const ops = [create, { type: 'score', id: 'g1', pid: 'pa', key: 'sixes', value: 24 }, { type: 'score', id: 'g1', pid: 'pa', key: 'sixes', value: 24 }];
  const once = ops.reduce(apply, []);
  assert.deepStrictEqual(ops.concat(ops).reduce(apply, []), once);
  assert.strictEqual(once[0].scores.pa.sixes, 24);
});

test('clearing a cell and losing the yahtzee drops the bonus', () => {
  let g = [create, { type: 'score', id: 'g1', pid: 'pa', key: 'yahtzee', value: 50 }, { type: 'score', id: 'g1', pid: 'pa', key: 'yahtzeeBonus', value: 2 }].reduce(apply, []);
  g = apply(g, { type: 'score', id: 'g1', pid: 'pa', key: 'yahtzee', value: null });
  assert.deepStrictEqual(g[0].scores.pa, {});
});

test('rejects malformed ops', () => {
  assert.strictEqual(validOp({ type: 'score', id: 'g1', pid: 'pa', key: '__proto__', value: 1 }), false);
  assert.strictEqual(validOp({ type: 'score', id: 'g1', pid: 'pa', key: 'ones', value: 2.5 }), false);
  assert.strictEqual(validOp({ type: 'create', game: { id: 'g/1', createdAt: 1, players: [] } }), false);
  assert.strictEqual(validOp(create), true);
});

test('server needs the spelcode and stores ops', async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.strictEqual((await fetch(base + '/api/state')).status, 401);
    const h = { 'Content-Type': 'application/json', 'X-Spelcode': 'dobbel' };
    const r = await fetch(base + '/api/ops', { method: 'POST', headers: h, body: JSON.stringify({ ops: [create, { type: 'score', id: 'g1', pid: 'pb', key: 'chance', value: 22 }] }) });
    const body = await r.json();
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.games[0].scores.pb.chance, 22);
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'games.json'), 'utf8'));
    assert.strictEqual(saved.games.length, 1);
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/../server.js')).status, 404);
  } finally { server.close(); }
});
