// LUDO BY BBTECH: online server. The server is the referee: it rolls the dice,
// checks every move, and sends the same state to every phone in the room.
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

/* ---------- rules (same as the game) ---------- */
const COLORS = ['red', 'green', 'yellow', 'blue'];
const START = { yellow: 0, green: 13, red: 26, blue: 39 };
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const tIdx = (c, p) => (START[c] + p - 1) % 52;
const die = () => crypto.randomInt(1, 7);

function legalMoves(G, p, d) {
  if (!d) return [];
  return G.players[p].tokens.map((t, i) => i).filter(i => {
    const t = G.players[p].tokens[i];
    return t === 0 ? d === 6 : (t < 58 && t + d <= 58);
  });
}
function tokensUsable(G, p) {
  const set = new Set();
  [0, 1].forEach(k => { if (G.left[k]) legalMoves(G, p, G.dice[k]).forEach(i => set.add(i)); });
  return [...set];
}
const anyLegal = (G, p) => tokensUsable(G, p).length > 0;
function addLog(G, m) { G.log.unshift(m); G.log = G.log.slice(0, 40); }
function endTurn(G) {
  G.phase = 'roll'; G.sixes = 0;
  do { G.turn = (G.turn + 1) % G.players.length; } while (G.players[G.turn].rank);
}
function doRoll(G) {
  const a = die(), b = die();
  G.dice = [a, b]; G.left = [true, true]; G.sel = null;
  G.rolledSix = a === 6 || b === 6;
  G.sixes = G.rolledSix ? G.sixes + 1 : 0;
  const name = G.players[G.turn].name;
  addLog(G, `${name} rolled ${a} and ${b}.`);
  if (G.sixes === 3) { addLog(G, `Three sixes in a row: ${name} loses the turn.`); return endTurn(G); }
  if (!anyLegal(G, G.turn)) { addLog(G, `No legal move for ${name}.`); return endTurn(G); }
  G.phase = 'move';
}
function doMove(G, i, k) {
  const p = G.turn, pl = G.players[p];
  if (G.phase !== 'move' || !G.left[k] || !legalMoves(G, p, G.dice[k]).includes(i)) return false;
  const d = G.dice[k];
  G.left[k] = false; G.sel = null;
  const old = pl.tokens[i], nt = old === 0 ? 1 : old + d;
  pl.tokens[i] = nt;
  const hits = [];
  if (nt <= 52) {
    const idx = tIdx(pl.color, nt);
    if (!SAFE.has(idx)) G.players.forEach((q, qi) => {
      if (qi === p) return;
      q.tokens.forEach((u, j) => {
        if (u >= 1 && u <= 52 && tIdx(q.color, u) === idx) { q.tokens[j] = 0; hits.push(q.name); }
      });
    });
  }
  if (hits.length) addLog(G, `${pl.name} captured ${hits.join(' and ')}!`);
  else if (nt === 58) addLog(G, `${pl.name} brought a token home.`);
  else if (old === 0) addLog(G, `${pl.name} brought a token out.`);
  if (pl.tokens.every(t => t === 58)) {
    pl.rank = ++G.finished; G.left = [false, false];
    addLog(G, `${pl.name} finished in place ${pl.rank}!`);
    if (G.finished >= G.players.length - 1) G.over = true;
  }
  if (G.over) return true;
  if (anyLegal(G, p)) { G.phase = 'move'; return true; }
  if (G.rolledSix && !pl.rank) { G.phase = 'roll'; return true; }
  endTurn(G); return true;
}

/* ---------- rooms ---------- */
const rooms = new Map();
const voiceRooms = new Map(); // NEW: code -> Map(socketId -> name)
function newCode() { let c; do { c = String(crypto.randomInt(1000, 10000)); } while (rooms.has(c)); return c; }
function newGame(r) {
  const cols = r.size === 2 ? ['red', 'yellow'] : COLORS;
  return {
    players: r.seats.map((s, k) => ({ name: s.name, color: cols[k], type: 'human', tokens: [0, 0, 0, 0], rank: null })),
    turn: 0, phase: 'roll', dice: null, left: [true, true], sel: null, rolledSix: false,
    sixes: 0, finished: 0, over: false, mode: 'pass', handoff: false,
    log: ['Match started. Roll a 6 to bring your first token out.']
  };
}
function publicState(r) {
  return { code: r.code, size: r.size, seats: r.seats.map(s => ({ name: s.name, connected: s.connected })), G: r.G };
}
const broadcast = r => io.to(r.code).emit('state', publicState(r));
const seatOf = (r, id) => r.seats.findIndex(s => s.id === id);

io.on('connection', socket => {
  const roomOf = () => rooms.get(socket.data.code);

  function seatJoin(r, name, ack) {
    const seat = { id: socket.id, name: String(name || 'Player').trim().slice(0, 16) || 'Player', token: crypto.randomUUID(), connected: true };
    r.seats.push(seat);
    socket.join(r.code); socket.data.code = r.code;
    ack({ ok: true, code: r.code, seat: r.seats.length - 1, token: seat.token });
    broadcast(r);
  }

  socket.on('room:create', ({ name, size } = {}, ack = () => {}) => {
    const r = { code: newCode(), size: size === 4 ? 4 : 2, seats: [], G: null };
    rooms.set(r.code, r);
    seatJoin(r, name, ack);
  });

  socket.on('room:join', ({ code, name } = {}, ack = () => {}) => {
    const r = rooms.get(String(code || '').trim());
    if (!r) return ack({ error: 'No room with that code.' });
    if (r.G) return ack({ error: 'That game has already started.' });
    if (r.seats.length >= r.size) return ack({ error: 'That room is full.' });
    seatJoin(r, name, ack);
  });

  // reconnect after a dropped connection: same seat, same game
  socket.on('room:rejoin', ({ code, token } = {}, ack = () => {}) => {
    const r = rooms.get(String(code || ''));
    if (!r) return ack({ error: 'Game not found.' });
    const s = r.seats.find(x => x.token === token);
    if (!s) return ack({ error: 'Your seat could not be found.' });
    s.id = socket.id; s.connected = true;
    socket.join(r.code); socket.data.code = r.code;
    ack({ ok: true, seat: r.seats.indexOf(s) });
    broadcast(r);
  });

  socket.on('room:start', (_, ack = () => {}) => {
    const r = roomOf();
    if (!r || r.G) return;
    if (seatOf(r, socket.id) !== 0) return ack({ error: 'Only the host can start the game.' });
    if (r.seats.length < r.size) return ack({ error: `Waiting for ${r.size - r.seats.length} more player(s).` });
    r.G = newGame(r);
    broadcast(r); ack({ ok: true });
  });

  socket.on('game:roll', () => {
    const r = roomOf(); if (!r || !r.G) return;
    const G = r.G, me = seatOf(r, socket.id);
    if (G.over || G.turn !== me || G.phase !== 'roll') return;
    doRoll(G); broadcast(r);
  });

  socket.on('game:move', ({ i, k } = {}) => {
    const r = roomOf(); if (!r || !r.G) return;
    const G = r.G, me = seatOf(r, socket.id);
    if (G.over || G.turn !== me || G.phase !== 'move') return;
    let kk = k;
    if (kk !== 0 && kk !== 1) kk = [0, 1].find(j => G.left[j] && legalMoves(G, me, G.dice[j]).includes(i));
    if (kk === undefined) return;
    if (doMove(G, i, kk)) broadcast(r);
  });

  /* ---------- voice (NEW): relays setup messages only, audio goes phone to phone ---------- */
  function leaveVoice() {
    const code = socket.data.code;
    const vr = voiceRooms.get(code);
    if (!vr) return;
    if (vr.delete(socket.id)) io.to(code).emit('voice:left', { id: socket.id });
    if (vr.size === 0) voiceRooms.delete(code);
  }

  socket.on('voice:join', ({ name } = {}, ack = () => {}) => {
    const code = socket.data.code;
    if (!code || !rooms.has(code)) return ack({ peers: [] });
    if (!voiceRooms.has(code)) voiceRooms.set(code, new Map());
    const vr = voiceRooms.get(code);
    const peers = [...vr.entries()].map(([id, n]) => ({ id, name: n }));
    const myName = String(name || 'Player').trim().slice(0, 16) || 'Player';
    vr.set(socket.id, myName);
    socket.to(code).emit('voice:joined', { id: socket.id, name: myName });
    ack({ peers });
  });

  socket.on('voice:signal', ({ to, data } = {}) => {
    const vr = voiceRooms.get(socket.data.code);
    if (!vr || !vr.has(socket.id) || !vr.has(to)) return;
    io.to(to).emit('voice:signal', { from: socket.id, data });
  });

  socket.on('voice:leave', () => leaveVoice());

  socket.on('disconnect', () => {
    leaveVoice(); // NEW: tell others this phone left voice
    const r = roomOf(); if (!r) return;
    const idx = seatOf(r, socket.id); if (idx < 0) return;
    if (r.G) {
      r.seats[idx].connected = false; broadcast(r);
      // drop the room if everyone is gone for 10 minutes
      setTimeout(() => { if (r.seats.every(s => !s.connected)) rooms.delete(r.code); }, 10 * 60 * 1000);
      return;
    }
    r.seats.splice(idx, 1);
    if (!r.seats.length) rooms.delete(r.code); else broadcast(r);
  });
});

server.listen(PORT, () => console.log(`LUDO BY BBTECH server running on port ${PORT}`));
