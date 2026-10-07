const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yz-'));
process.env.SPELCODE = ' "Dobbel" ';
const { apply, validOp, turnOf, migrate } = require('../public/apply.js');
const { server } = require('../server.js');

const EMPTY = { games: [], players: [] };
const create = { type: 'create', game: { id: 'g1', createdAt: 1, players: [{ id: 'pa', name: 'Rene' }, { id: 'pb', name: 'Anna' }] } };

test('ops replay to the same result', () => {
  const ops = [create, { type: 'score', id: 'g1', pid: 'pa', key: 'sixes', value: 24 }, { type: 'score', id: 'g1', pid: 'pa', key: 'sixes', value: 24 }];
  const once = ops.reduce(apply, EMPTY);
  assert.deepStrictEqual(ops.concat(ops).reduce(apply, EMPTY), once);
  assert.strictEqual(once.games[0].scores.pa.sixes, 24);
});

test('clearing a cell and losing the yahtzee drops the bonus', () => {
  let g = [create, { type: 'score', id: 'g1', pid: 'pa', key: 'yahtzee', value: 50 }, { type: 'score', id: 'g1', pid: 'pa', key: 'yahtzeeBonus', value: 2 }].reduce(apply, EMPTY);
  g = apply(g, { type: 'score', id: 'g1', pid: 'pa', key: 'yahtzee', value: null });
  assert.deepStrictEqual(g.games[0].scores.pa, {});
});

test('only the player at turn can fill an empty box', () => {
  const sc = (pid, key, value) => ({ type: 'score', id: 'g1', pid, key, value });
  let g = [create, sc('pa', 'ones', 2)].reduce(apply, EMPTY);
  // Rene (pa) played; filling another empty box for Rene is refused until Anna (pb) has played
  g = apply(g, sc('pa', 'twos', 4));
  assert.strictEqual(g.games[0].scores.pa.twos, undefined);
  assert.strictEqual(turnOf(g.games[0]).player.id, 'pb');
  // correcting a box that is already filled is always allowed, and so is clearing one
  g = apply(g, sc('pa', 'ones', 3));
  assert.strictEqual(g.games[0].scores.pa.ones, 3);
  g = apply(g, sc('pb', 'sixes', 18));
  assert.strictEqual(g.games[0].scores.pb.sixes, 18);
  assert.strictEqual(turnOf(g.games[0]).player.id, 'pa');
  assert.strictEqual(turnOf(g.games[0]).round, 2);
  g = apply(g, sc('pa', 'ones', null));
  assert.strictEqual(turnOf(g.games[0]).round, 1);
});

test('players are saved and games point at them', () => {
  let d = apply(EMPTY, create);
  assert.deepStrictEqual(d.players.map(r => [r.id, r.name]), [['rpa', 'Rene'], ['rpb', 'Anna']]);
  assert.deepStrictEqual(d.games[0].players.map(p => p.playerId), ['rpa', 'rpb']);
  // a new game picking saved players by id, and an old client sending only a name, both reuse them
  d = apply(d, { type: 'create', game: { id: 'g2', createdAt: 2, players: [{ id: 'px', name: 'Anna', playerId: 'rpb' }, { id: 'py', name: ' rene ' }] } });
  assert.deepStrictEqual(d.games[0].players.map(p => p.playerId), ['rpb', 'rpa']);
  assert.strictEqual(d.players.length, 2);
  // renaming keeps the id, a duplicate name is refused, removing keeps the games
  d = apply(d, { type: 'player', player: { id: 'rpa', name: 'René' } });
  assert.strictEqual(d.players.find(r => r.id === 'rpa').name, 'René');
  d = apply(d, { type: 'player', player: { id: 'rnew', name: 'anna' } });
  assert.strictEqual(d.players.length, 2);
  d = apply(d, { type: 'removePlayer', id: 'rpb' });
  assert.deepStrictEqual(d.players.map(r => r.id), ['rpa']);
  assert.strictEqual(d.games.length, 2);
});

test('migrate links games saved before the player list existed', () => {
  const old = { version: 3, games: [
    { id: 'g2', createdAt: 20, players: [{ id: 'b1', name: 'sandra' }, { id: 'b2', name: 'Rene' }], scores: {} },
    { id: 'g1', createdAt: 10, players: [{ id: 'a1', name: 'Sandra' }, { id: 'a2', name: 'Rene' }], scores: {} },
  ] };
  const d = migrate(old);
  assert.deepStrictEqual(d.players.map(r => r.name), ['Sandra', 'Rene']);
  assert.deepStrictEqual(d.games.map(g => g.players.map(p => p.playerId)), [['ra1', 'ra2'], ['ra1', 'ra2']]);
  assert.strictEqual(d.version, 3);
  assert.deepStrictEqual(migrate(d), d);
});

test('rejects malformed ops', () => {
  assert.strictEqual(validOp({ type: 'score', id: 'g1', pid: 'pa', key: '__proto__', value: 1 }), false);
  assert.strictEqual(validOp({ type: 'score', id: 'g1', pid: 'pa', key: 'ones', value: 2.5 }), false);
  assert.strictEqual(validOp({ type: 'create', game: { id: 'g/1', createdAt: 1, players: [] } }), false);
  assert.strictEqual(validOp(create), true);
  assert.strictEqual(validOp({ type: 'player', player: { id: 'r1', name: '  ' } }), false);
});

test('server needs the spelcode and stores ops', async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.strictEqual((await fetch(base + '/api/state')).status, 401);
    assert.strictEqual((await fetch(base + '/api/state', { headers: { 'X-Spelcode': 'dobbels' } })).status, 401);
    assert.strictEqual((await fetch(base + '/api/state', { headers: { 'X-Spelcode': ' DOBBEL ' } })).status, 200);
    const h = { 'Content-Type': 'application/json', 'X-Spelcode': 'dobbel' };
    const r = await fetch(base + '/api/ops', { method: 'POST', headers: h, body: JSON.stringify({ ops: [create, { type: 'score', id: 'g1', pid: 'pa', key: 'ones', value: 3 }, { type: 'score', id: 'g1', pid: 'pb', key: 'chance', value: 22 }] }) });
    const body = await r.json();
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.games[0].scores.pb.chance, 22);
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'games.json'), 'utf8'));
    assert.strictEqual(saved.games.length, 1);
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /<script src="apply\.js\?v=[0-9a-f]{12}"><\/script>/);
    assert.strictEqual((await fetch(base + '/apply.js?v=abc')).status, 200);
    assert.strictEqual((await fetch(base + '/../server.js')).status, 404);
  } finally { server.close(); }
});
