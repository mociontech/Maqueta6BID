const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const experience = require('./data/experience.json');

const PORT = Number(process.env.PORT || 3000);
const AUTO_RESET_MS = Number(process.env.AUTO_RESET_MS || 60000);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));
app.get('/', (_req, res) => res.redirect('/controller/'));

const initialState = {
  segmentId: null,
  instrumentId: null,
  phase: 'idle',
  selectionMode: 'initial',
  runId: 0,
  updatedAt: Date.now()
};

const timings = experience.animationTimings;
const routePhases = [
  { phase: 'instrument', duration: timings.solutionReadMs || 5500 },
  { phase: 'route', duration: timings.actorRouteMs },
  { phase: 'result', duration: null }
];

let state = { ...initialState };
let routeTimer = null;
let autoResetTimer = null;

function findSegment(id) {
  return experience.segments.find(segment => segment.id === id);
}

function findInstrument(id) {
  return experience.instruments.find(instrument => instrument.id === id);
}

function isAllowedSelection(segmentId, instrumentId) {
  const segment = findSegment(segmentId);
  const instrument = findInstrument(instrumentId);
  return Boolean(segment && instrument && segment.allowedInstruments.includes(instrument.id));
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function clearRouteTimer() {
  if (!routeTimer) return;
  clearTimeout(routeTimer);
  routeTimer = null;
}

function clearAutoResetTimer() {
  if (!autoResetTimer) return;
  clearTimeout(autoResetTimer);
  autoResetTimer = null;
}

function scheduleAutoReset() {
  clearAutoResetTimer();
  if (!AUTO_RESET_MS || AUTO_RESET_MS < 0 || state.phase === 'idle') return;
  autoResetTimer = setTimeout(() => resetState('auto-reset'), AUTO_RESET_MS);
}

function setState(patch, source = 'server', options = {}) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  broadcast({ type: 'state', state, source });
  if (options.autoReset !== false) scheduleAutoReset();
}

function resetState(source = 'controller') {
  clearRouteTimer();
  clearAutoResetTimer();
  state = { ...initialState, runId: state.runId + 1, updatedAt: Date.now() };
  broadcast({ type: 'state', state, source });
}

function selectSegment(segmentId, source = 'controller') {
  if (!findSegment(segmentId)) return;
  clearRouteTimer();
  setState({
    segmentId,
    instrumentId: null,
    phase: 'problem',
    selectionMode: 'initial',
    runId: state.runId + 1
  }, source);
}

function showSolutions(segmentId, source = 'controller', comparison = false) {
  const nextSegmentId = segmentId || state.segmentId;
  if (!findSegment(nextSegmentId)) return;
  clearRouteTimer();
  setState({
    segmentId: nextSegmentId,
    instrumentId: null,
    phase: 'solutions',
    selectionMode: comparison ? 'compare' : 'initial',
    runId: state.runId + 1
  }, source);
}

function scheduleNextPhase(runId, index) {
  const current = routePhases[index];
  if (!current || current.duration === null) {
    scheduleAutoReset();
    return;
  }

  routeTimer = setTimeout(() => {
    if (runId !== state.runId) return;
    const next = routePhases[index + 1];
    if (!next) return;
    setState({ phase: next.phase }, 'sequence');
    scheduleNextPhase(runId, index + 1);
  }, current.duration);
}

function runRoute(segmentId, instrumentId, source = 'controller') {
  const nextSegmentId = segmentId || state.segmentId;
  const nextInstrumentId = instrumentId || state.instrumentId;
  if (!isAllowedSelection(nextSegmentId, nextInstrumentId)) return;

  clearRouteTimer();
  const runId = state.runId + 1;
  setState({
    segmentId: nextSegmentId,
    instrumentId: nextInstrumentId,
    phase: routePhases[0].phase,
    selectionMode: 'route',
    runId
  }, source);
  scheduleNextPhase(runId, 0);
}

function applyClientPatch(patch, source = 'client') {
  if (patch.phase === 'idle') {
    resetState(source);
    return;
  }

  if (patch.phase === 'bankIntro' || patch.phase === 'closing') {
    clearRouteTimer();
    setState({
      segmentId: patch.segmentId === undefined ? state.segmentId : patch.segmentId,
      instrumentId: patch.instrumentId === undefined ? state.instrumentId : patch.instrumentId,
      phase: patch.phase,
      selectionMode: patch.selectionMode || state.selectionMode,
      runId: state.runId + 1
    }, source);
    return;
  }

  if (patch.segmentId && !patch.instrumentId) {
    if (patch.phase === 'solutions') showSolutions(patch.segmentId, source, patch.selectionMode === 'compare');
    else selectSegment(patch.segmentId, source);
    return;
  }

  if (patch.segmentId && patch.instrumentId && isAllowedSelection(patch.segmentId, patch.instrumentId)) {
    clearRouteTimer();
    setState({
      segmentId: patch.segmentId,
      instrumentId: patch.instrumentId,
      phase: patch.phase || state.phase,
      runId: state.runId + 1
    }, source);
  }
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });
  socket.send(JSON.stringify({ type: 'state', state, source: 'server' }));

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === 'setState' && msg.patch && typeof msg.patch === 'object') {
      applyClientPatch(msg.patch, msg.source || 'client');
    }

    if (msg.type === 'selectSegment') {
      selectSegment(msg.segmentId, msg.source || 'controller');
    }

    if (msg.type === 'showSolutions') {
      showSolutions(msg.segmentId, msg.source || 'controller', Boolean(msg.comparison));
    }

    if (msg.type === 'runRoute') {
      runRoute(msg.segmentId, msg.instrumentId, msg.source || 'controller');
    }

    if (msg.type === 'reset') {
      resetState(msg.source || 'controller');
    }
  });
});

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nMaqueta 6 BID ejecutándose en http://localhost:${PORT}`);
  console.log(`Tablet:  http://localhost:${PORT}/controller/`);
  console.log(`TV:      http://localhost:${PORT}/display/\n`);
  console.log(`Auto-reset: ${AUTO_RESET_MS > 0 ? `${AUTO_RESET_MS} ms` : 'desactivado'}\n`);
});
