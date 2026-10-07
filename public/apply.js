// Shared by the server (require) and the browser (window.YZ): applies one change to the data,
// which is { games, players }. `players` is the saved list of people; each player in a game points
// to one of them through `playerId`, so scores stay with the person even after a rename.
// Every op sets absolute state, so replaying an op twice gives the same result.
(function (root) {
  const CAT_KEYS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'threeKind', 'fourKind',
    'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance', 'yahtzeeBonus'];
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  const BOXES = CAT_KEYS.filter(k => k !== 'yahtzeeBonus');

  // Every turn fills exactly one box, so whoever has filled the fewest boxes plays next;
  // on a tie the earliest player in the column order goes first. Null once every box is filled.
  const filledCount = (g, pid) => BOXES.filter(k => typeof (g.scores[pid] || {})[k] === 'number').length;
  function turnOf(g) {
    const players = g.players || [];
    if (!players.length) return null;
    const counts = players.map(p => filledCount(g, p.id));
    const min = Math.min(...counts);
    if (min >= BOXES.length) return null;
    return { player: players[counts.indexOf(min)], round: min + 1 };
  }

  // Filling an empty box is only allowed for the player whose turn it is. Changing or clearing
  // a box that already has a score is always allowed, so a typo can be corrected afterwards.
  function allowed(g, op) {
    if (op.key === 'yahtzeeBonus' || op.value === null) return true;
    if (typeof (g.scores[op.pid] || {})[op.key] === 'number') return true;
    const turn = turnOf(g);
    return !!turn && turn.player.id === op.pid;
  }

  const nameKey = n => String(n || '').trim().toLowerCase();
  const validName = n => typeof n === 'string' && n.trim().length >= 1 && n.length <= 30;

  // Points every game player at a saved player: the given playerId, else the saved player with the
  // same name, else a new saved player. Ids derive from the game player's id, so the browser and the
  // server create the same ones.
  function linkPlayers(roster, gamePlayers, createdAt) {
    let players = roster;
    const linked = gamePlayers.map(gp => {
      let rp = gp.playerId && players.find(r => r.id === gp.playerId);
      if (!rp && !gp.playerId) rp = players.find(r => nameKey(r.name) === nameKey(gp.name));
      if (!rp) {
        rp = { id: gp.playerId || 'r' + gp.id, name: gp.name.trim(), createdAt: createdAt || 0 };
        players = [...players, rp];
      }
      return { id: gp.id, name: gp.name, playerId: rp.id };
    });
    return { players, linked };
  }

  // Brings data saved before the player list existed up to date. Safe to run on current data.
  function migrate(data) {
    let players = Array.isArray(data.players) ? data.players : [];
    const games = (data.games || []).slice().sort((a, b) => a.createdAt - b.createdAt).map(g => {
      if (g.players.every(p => p.playerId)) return g;
      const r = linkPlayers(players, g.players, g.createdAt);
      players = r.players;
      return { ...g, players: r.linked };
    }).sort((a, b) => b.createdAt - a.createdAt);
    return { ...data, games, players };
  }

  function validOp(op) {
    if (!op || typeof op !== 'object') return false;
    if (op.type === 'create') {
      const g = op.game;
      return !!g && ID.test(g.id) && typeof g.createdAt === 'number' && Array.isArray(g.players) &&
        g.players.length >= 1 && g.players.length <= 6 &&
        g.players.every(p => p && ID.test(p.id) && validName(p.name) && (p.playerId === undefined || ID.test(p.playerId)));
    }
    if (op.type === 'player') return !!op.player && ID.test(op.player.id) && validName(op.player.name);
    if (op.type === 'removePlayer') return ID.test(op.id);
    if (op.type === 'score') {
      return ID.test(op.id) && ID.test(op.pid) && CAT_KEYS.includes(op.key) &&
        (op.value === null || (Number.isInteger(op.value) && op.value >= 0 && op.value <= 5000));
    }
    if (op.type === 'delete') return ID.test(op.id);
    return false;
  }

  function apply(data, op) {
    const games = data.games;
    if (op.type === 'player') {
      const name = op.player.name.trim();
      if (data.players.some(r => r.id !== op.player.id && nameKey(r.name) === nameKey(name))) return data;
      const existing = data.players.find(r => r.id === op.player.id);
      const players = existing
        ? data.players.map(r => r.id === op.player.id ? { ...r, name } : r)
        : [...data.players, { id: op.player.id, name, createdAt: op.player.createdAt || 0 }];
      return { ...data, players };
    }
    if (op.type === 'removePlayer') return { ...data, players: data.players.filter(r => r.id !== op.id) };
    if (op.type === 'create') {
      if (games.some(g => g.id === op.game.id)) return data;
      const { players, linked } = linkPlayers(data.players, op.game.players, op.game.createdAt);
      const scores = {};
      linked.forEach(p => { scores[p.id] = {}; });
      const game = { id: op.game.id, createdAt: op.game.createdAt, players: linked, scores };
      return { ...data, players, games: [game, ...games].sort((a, b) => b.createdAt - a.createdAt) };
    }
    if (op.type === 'delete') return { ...data, games: games.filter(g => g.id !== op.id) };
    if (op.type === 'score') {
      return { ...data, games: games.map(g => {
        if (g.id !== op.id || !g.players.some(p => p.id === op.pid) || !allowed(g, op)) return g;
        const sc = { ...(g.scores[op.pid] || {}) };
        if (op.value === null) delete sc[op.key]; else sc[op.key] = op.value;
        if (op.key === 'yahtzee' && op.value !== 50) delete sc.yahtzeeBonus;
        return { ...g, scores: { ...g.scores, [op.pid]: sc } };
      }) };
    }
    return data;
  }

  const api = { apply, validOp, migrate, turnOf, allowed, nameKey, CAT_KEYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YZ = api;
})(typeof self !== 'undefined' ? self : this);
