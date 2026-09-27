const experience = require('../../data/experience.json');

const STORE_NAME = 'maqueta6-sync-state';
const DEFAULT_ROOM = 'default';
const AUTO_RESET_MS = 60000;
const INTRO_LOCK_MS = experience.animationTimings?.mandatoryIntroLockMs || 24000;
const TRANSFORMATION_LOCK_MS = experience.animationTimings?.transformationLockMs || 12000;

const timings = experience.animationTimings || {};
const routePhases = [
  { phase: 'instrument', duration: timings.solutionReadMs || 5500 },
  { phase: 'route', duration: timings.actorRouteMs || 2800 },
  { phase: 'result', duration: null }
];

const initialState = {
  segmentId: null,
  instrumentId: null,
  phase: 'idle',
  selectionMode: 'initial',
  runId: 0,
  lockedUntil: 0,
  updatedAt: Date.now()
};

const memoryStore = globalThis.__maqueta6SyncStore || new Map();
globalThis.__maqueta6SyncStore = memoryStore;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    },
    body: JSON.stringify(body)
  };
}

function cleanRoom(value) {
  return String(value || DEFAULT_ROOM)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48) || DEFAULT_ROOM;
}

function keyForRoom(room) {
  return `room:${cleanRoom(room)}`;
}

async function getBlobStore() {
  try {
    const { getStore } = await import('@netlify/blobs');
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
  }
}

async function readStoredState(key) {
  const store = await getBlobStore();
  if (store) {
    try {
      const cloudState = await store.get(key, { type: 'json', consistency: 'strong' });
      if (cloudState) return cloudState;
    } catch {
      // Local direct invocation can run without Netlify Blobs credentials.
    }
  }
  return memoryStore.get(key) || { ...initialState, updatedAt: Date.now() };
}

async function writeStoredState(key, state, { touch = true } = {}) {
  const nextState = touch ? { ...state, updatedAt: Date.now() } : state;
  memoryStore.set(key, nextState);
  const store = await getBlobStore();
  if (store) {
    try {
      await store.setJSON(key, nextState);
    } catch {
      // Keep the in-memory fallback for local tests if Blobs is unavailable.
    }
  }
  return nextState;
}

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

function isInteractionLocked(state) {
  return Number(state.lockedUntil || 0) > Date.now();
}

function advanceScheduledState(state) {
  let nextState = { ...state };
  let changed = false;
  const now = Date.now();

  if (nextState.phase !== 'idle' && AUTO_RESET_MS > 0 && Number(nextState.updatedAt || 0) + AUTO_RESET_MS < now) {
    return {
      ...initialState,
      runId: Number(nextState.runId || 0) + 1,
      updatedAt: now
    };
  }

  while (nextState.nextPhaseAt && now >= nextState.nextPhaseAt) {
    const currentIndex = routePhases.findIndex(item => item.phase === nextState.phase);
    const nextPhase = routePhases[currentIndex + 1];
    if (!nextPhase) {
      delete nextState.nextPhaseAt;
      changed = true;
      break;
    }
    nextState.phase = nextPhase.phase;
    if (nextPhase.duration === null) {
      delete nextState.nextPhaseAt;
    } else {
      nextState.nextPhaseAt += nextPhase.duration;
    }
    changed = true;
  }

  return changed ? { ...nextState, updatedAt: now } : nextState;
}

function resetState(current) {
  return {
    ...initialState,
    runId: Number(current.runId || 0) + 1,
    updatedAt: Date.now()
  };
}

function selectSegment(current, segmentId) {
  if (!findSegment(segmentId)) return current;
  return {
    ...current,
    segmentId,
    instrumentId: null,
    phase: 'problem',
    selectionMode: 'initial',
    runId: Number(current.runId || 0) + 1,
    lockedUntil: 0,
    nextPhaseAt: null,
    updatedAt: Date.now()
  };
}

function showSolutions(current, segmentId, comparison = false) {
  const nextSegmentId = segmentId || current.segmentId;
  if (!findSegment(nextSegmentId)) return current;
  return {
    ...current,
    segmentId: nextSegmentId,
    instrumentId: null,
    phase: 'solutions',
    selectionMode: comparison ? 'compare' : 'initial',
    runId: Number(current.runId || 0) + 1,
    lockedUntil: 0,
    nextPhaseAt: null,
    updatedAt: Date.now()
  };
}

function runRoute(current, segmentId, instrumentId) {
  const nextSegmentId = segmentId || current.segmentId;
  const nextInstrumentId = instrumentId || current.instrumentId;
  if (!isAllowedSelection(nextSegmentId, nextInstrumentId)) return current;
  const runId = Number(current.runId || 0) + 1;
  const firstPhase = routePhases[0];
  return {
    ...current,
    segmentId: nextSegmentId,
    instrumentId: nextInstrumentId,
    phase: firstPhase.phase,
    selectionMode: 'route',
    runId,
    lockedUntil: 0,
    nextPhaseAt: Date.now() + firstPhase.duration,
    updatedAt: Date.now()
  };
}

function applyPatch(current, patch = {}) {
  if (patch.phase === 'idle') return resetState(current);

  if (patch.phase === 'bankIntro' || patch.phase === 'closing') {
    const lockedUntil = patch.lockedUntil !== undefined
      ? Number(patch.lockedUntil)
      : patch.phase === 'bankIntro'
        ? Date.now() + INTRO_LOCK_MS
        : Date.now() + (patch.lockedMs !== undefined ? Number(patch.lockedMs) : TRANSFORMATION_LOCK_MS);

    return {
      ...current,
      segmentId: patch.segmentId === undefined ? current.segmentId : patch.segmentId,
      instrumentId: patch.instrumentId === undefined ? current.instrumentId : patch.instrumentId,
      phase: patch.phase,
      selectionMode: patch.selectionMode || current.selectionMode,
      runId: Number(current.runId || 0) + 1,
      lockedUntil,
      nextPhaseAt: null,
      updatedAt: Date.now()
    };
  }

  if (patch.segmentId && !patch.instrumentId) {
    return patch.phase === 'solutions'
      ? showSolutions(current, patch.segmentId, patch.selectionMode === 'compare')
      : selectSegment(current, patch.segmentId);
  }

  if (patch.segmentId && patch.instrumentId && isAllowedSelection(patch.segmentId, patch.instrumentId)) {
    return {
      ...current,
      segmentId: patch.segmentId,
      instrumentId: patch.instrumentId,
      phase: patch.phase || current.phase,
      runId: Number(current.runId || 0) + 1,
      lockedUntil: 0,
      updatedAt: Date.now()
    };
  }

  return current;
}

function applyMessage(current, message = {}) {
  if (message.type === 'reset') return resetState(current);
  if (isInteractionLocked(current)) return current;

  if (message.type === 'selectSegment') return selectSegment(current, message.segmentId);
  if (message.type === 'showSolutions') return showSolutions(current, message.segmentId, Boolean(message.comparison));
  if (message.type === 'runRoute') return runRoute(current, message.segmentId, message.instrumentId);
  if (message.type === 'setState' && message.patch && typeof message.patch === 'object') {
    return applyPatch(current, message.patch);
  }

  return current;
}

exports.handler = async (event) => {
  const room = cleanRoom(event.queryStringParameters?.room);
  const key = keyForRoom(room);
  let state = advanceScheduledState(await readStoredState(key));

  if (event.httpMethod === 'GET') {
    state = await writeStoredState(key, state, { touch: false });
    return json(200, { type: 'state', room, state, source: 'cloud' });
  }

  if (event.httpMethod === 'POST') {
    let message;
    try {
      message = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
    const nextState = applyMessage(state, message);
    state = await writeStoredState(key, advanceScheduledState(nextState));
    return json(200, { type: 'state', room, state, source: message.source || 'cloud' });
  }

  return json(405, { error: 'Method not allowed' });
};
