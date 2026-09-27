import { getStore } from '@netlify/blobs';
import experience from '../../data/experience.json' with { type: 'json' };

const STORE_NAME = 'maqueta6-sync-state';
const DEFAULT_ROOM = 'default';
const AUTO_RESET_MS = 0;
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
  completedSegmentIds: [],
  runId: 0,
  lockedUntil: 0,
  updatedAt: Date.now()
};

const memoryStore = globalThis.__maqueta6SyncStore || new Map();
globalThis.__maqueta6SyncStore = memoryStore;

function cleanRoom(value) {
  return String(value || DEFAULT_ROOM)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 48) || DEFAULT_ROOM;
}

function keyForRoom(room) {
  return `room:${cleanRoom(room)}`;
}

const MAX_WRITE_ATTEMPTS = 6;

class StorageError extends Error {}

// Functions v2 get Netlify Blobs configured automatically (including strong reads).
// Only when there is no Blobs environment at all (local direct invocation) do we use memory.
function getBlobStore() {
  try {
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
  }
}

async function readStoredState(store, key) {
  if (!store) {
    const local = memoryStore.get(key);
    return { state: local || { ...initialState, updatedAt: Date.now() }, etag: null, exists: Boolean(local) };
  }
  let result;
  try {
    result = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
  } catch (error) {
    // Never invent a state: an error makes the client retry instead of seeing a stale/empty one.
    console.error('sync-state read failed', error);
    throw new StorageError('read failed');
  }
  if (result?.data) return { state: result.data, etag: result.etag || null, exists: true };
  return { state: { ...initialState, updatedAt: Date.now() }, etag: null, exists: false };
}

// Writes only if nobody else wrote since we read (compare-and-swap on the etag).
// Returns null when another write won the race so the caller can retry.
async function writeStoredState(store, key, state, read) {
  const nextState = {
    ...state,
    rev: Number(read.state.rev || 0) + 1,
    updatedAt: Date.now()
  };
  if (!store) {
    memoryStore.set(key, nextState);
    return nextState;
  }
  const conditions = read.exists && read.etag ? { onlyIfMatch: read.etag } : { onlyIfNew: true };
  let result;
  try {
    result = await store.setJSON(key, nextState, conditions);
  } catch (error) {
    console.error('sync-state write failed', error);
    return null;
  }
  if (result && result.modified === false) return null;
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

function normalizeCompletedSegmentIds(ids = []) {
  const allowedIds = new Set(experience.segments.map(segment => segment.id));
  const normalized = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (allowedIds.has(id) && !normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

function appendCompletedSegment(current, segmentId) {
  return normalizeCompletedSegmentIds([
    ...normalizeCompletedSegmentIds(current.completedSegmentIds),
    segmentId
  ]);
}

function isInteractionLocked(state) {
  return Number(state.lockedUntil || 0) > Date.now();
}

function clientSeqsFor(state = {}) {
  return state.clientSeqs && typeof state.clientSeqs === 'object'
    ? state.clientSeqs
    : {};
}

function isStaleClientMessage(current, message = {}) {
  const clientId = String(message.clientId || '');
  const clientSeq = Number(message.clientSeq || 0);
  if (!clientId || !Number.isFinite(clientSeq) || clientSeq <= 0) return false;
  return clientSeq <= Number(clientSeqsFor(current)[clientId] || 0);
}

function stampClientMessage(current, next, message = {}) {
  const clientId = String(message.clientId || '');
  const clientSeq = Number(message.clientSeq || 0);
  if (!clientId || !Number.isFinite(clientSeq) || clientSeq <= 0) return next;
  return {
    ...next,
    clientSeqs: {
      ...clientSeqsFor(current),
      [clientId]: clientSeq
    }
  };
}

function advanceScheduledState(state) {
  let nextState = { ...state };
  let changed = false;
  const now = Date.now();

  if (nextState.phase !== 'idle' && nextState.phase !== 'closing' && AUTO_RESET_MS > 0 && Number(nextState.updatedAt || 0) + AUTO_RESET_MS < now) {
    return {
      ...initialState,
      clientSeqs: clientSeqsFor(nextState),
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
    clientSeqs: clientSeqsFor(current),
    runId: Number(current.runId || 0) + 1,
    updatedAt: Date.now()
  };
}

function selectSegment(current, segmentId, completedSegmentIds) {
  if (!findSegment(segmentId)) return current;
  return {
    ...current,
    segmentId,
    instrumentId: null,
    phase: 'problem',
    selectionMode: 'initial',
    completedSegmentIds: completedSegmentIds === undefined
      ? normalizeCompletedSegmentIds(current.completedSegmentIds)
      : normalizeCompletedSegmentIds(completedSegmentIds),
    runId: Number(current.runId || 0) + 1,
    lockedUntil: 0,
    nextPhaseAt: null,
    updatedAt: Date.now()
  };
}

function completeSegment(current, segmentId, completedSegmentIds) {
  if (!findSegment(segmentId)) return current;
  return {
    ...current,
    completedSegmentIds: completedSegmentIds === undefined
      ? appendCompletedSegment(current, segmentId)
      : normalizeCompletedSegmentIds([...(Array.isArray(completedSegmentIds) ? completedSegmentIds : []), segmentId]),
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
    completedSegmentIds: appendCompletedSegment(current, nextSegmentId),
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
    completedSegmentIds: appendCompletedSegment(current, nextSegmentId),
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
      completedSegmentIds: patch.completedSegmentIds === undefined
        ? normalizeCompletedSegmentIds(current.completedSegmentIds)
        : normalizeCompletedSegmentIds(patch.completedSegmentIds),
      runId: Number(current.runId || 0) + 1,
      lockedUntil,
      nextPhaseAt: null,
      updatedAt: Date.now()
    };
  }

  if (patch.segmentId && !patch.instrumentId) {
    return patch.phase === 'solutions'
      ? showSolutions(current, patch.segmentId, patch.selectionMode === 'compare')
      : selectSegment(current, patch.segmentId, patch.completedSegmentIds);
  }

  if (patch.segmentId && patch.instrumentId && isAllowedSelection(patch.segmentId, patch.instrumentId)) {
    return {
      ...current,
      segmentId: patch.segmentId,
      instrumentId: patch.instrumentId,
      phase: patch.phase || current.phase,
      completedSegmentIds: patch.completedSegmentIds === undefined
        ? appendCompletedSegment(current, patch.segmentId)
        : normalizeCompletedSegmentIds(patch.completedSegmentIds),
      runId: Number(current.runId || 0) + 1,
      lockedUntil: 0,
      updatedAt: Date.now()
    };
  }

  return current;
}

function applyMessage(current, message = {}) {
  if (isStaleClientMessage(current, message)) return current;

  let nextState = current;

  if (message.type === 'reset') {
    nextState = resetState(current);
  } else if (isInteractionLocked(current) && !message.force) {
    nextState = current;
  } else if (message.type === 'selectSegment') {
    nextState = selectSegment(current, message.segmentId, message.completedSegmentIds);
  } else if (message.type === 'completeSegment') {
    nextState = completeSegment(current, message.segmentId, message.completedSegmentIds);
  } else if (message.type === 'showSolutions') {
    nextState = showSolutions(current, message.segmentId, Boolean(message.comparison));
  } else if (message.type === 'runRoute') {
    nextState = runRoute(current, message.segmentId, message.instrumentId);
  } else if (message.type === 'setState' && message.patch && typeof message.patch === 'object') {
    nextState = applyPatch(current, message.patch);
  }

  return stampClientMessage(current, nextState, message);
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const room = cleanRoom(url.searchParams.get('room'));
  const key = keyForRoom(room);
  const store = getBlobStore();
  const storage = store ? 'blobs' : 'memory';

  try {
    if (req.method === 'GET') {
      // Never write on GET: polls from the TV must not overwrite tablet changes.
      const read = await readStoredState(store, key);
      return json(200, { type: 'state', room, state: advanceScheduledState(read.state), source: 'cloud', storage });
    }

    if (req.method === 'POST') {
      let message;
      try {
        message = JSON.parse(await req.text() || '{}');
      } catch {
        return json(400, { error: 'Invalid JSON' });
      }

      for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
        const read = await readStoredState(store, key);
        const current = advanceScheduledState(read.state);
        if (isStaleClientMessage(current, message)) {
          return json(200, { type: 'state', room, state: current, source: 'cloud', storage, duplicate: true });
        }
        const nextState = advanceScheduledState(applyMessage(current, message));
        const written = await writeStoredState(store, key, nextState, read);
        if (written) {
          return json(200, { type: 'state', room, state: written, source: message.source || 'cloud', storage });
        }
        await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 80 * (attempt + 1)));
      }
      return json(409, { error: 'Concurrent update, retry' });
    }
  } catch (error) {
    if (error instanceof StorageError) return json(503, { error: 'Storage unavailable, retry' });
    throw error;
  }

  return json(405, { error: 'Method not allowed' });
};

export const config = {
  path: '/.netlify/functions/sync-state'
};
