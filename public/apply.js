// Shared by the server (require) and the browser (window.YZ): applies one change to the games list.
// Every op sets absolute state, so replaying an op twice gives the same result.
(function (root) {
  const CAT_KEYS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'threeKind', 'fourKind',
    'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance', 'yahtzeeBonus'];
  const ID = /^[A-Za-z0-9_-]{1,40}$/;

  function validOp(op) {
    if (!op || typeof op !== 'object') return false;
    if (op.type === 'create') {
      const g = op.game;
      return !!g && ID.test(g.id) && typeof g.createdAt === 'number' && Array.isArray(g.players) &&
        g.players.length >= 1 && g.players.length <= 6 &&
        g.players.every(p => p && ID.test(p.id) && typeof p.name === 'string' && p.name.length <= 30);
    }
    if (op.type === 'score') {
      return ID.test(op.id) && ID.test(op.pid) && CAT_KEYS.includes(op.key) &&
        (op.value === null || (Number.isInteger(op.value) && op.value >= 0 && op.value <= 5000));
    }
    if (op.type === 'delete') return ID.test(op.id);
    return false;
  }

  function apply(games, op) {
    if (op.type === 'create') {
      if (games.some(g => g.id === op.game.id)) return games;
      const scores = {};
      op.game.players.forEach(p => { scores[p.id] = {}; });
      const game = { id: op.game.id, createdAt: op.game.createdAt, players: op.game.players.map(p => ({ id: p.id, name: p.name })), scores };
      return [game, ...games].sort((a, b) => b.createdAt - a.createdAt);
    }
    if (op.type === 'delete') return games.filter(g => g.id !== op.id);
    if (op.type === 'score') {
      return games.map(g => {
        if (g.id !== op.id || !g.players.some(p => p.id === op.pid)) return g;
        const sc = { ...(g.scores[op.pid] || {}) };
        if (op.value === null) delete sc[op.key]; else sc[op.key] = op.value;
        if (op.key === 'yahtzee' && op.value !== 50) delete sc.yahtzeeBonus;
        return { ...g, scores: { ...g.scores, [op.pid]: sc } };
      });
    }
    return games;
  }

  const api = { apply, validOp, CAT_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YZ = api;
})(typeof self !== 'undefined' ? self : this);
