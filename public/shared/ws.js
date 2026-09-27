export function createExperienceSocket(onState) {
  let socket;
  let retryTimer;
  let phaseTimer;
  let cloudPollTimer;
  let cloudSendQueue = Promise.resolve();
  let cloudPendingSends = 0;
  let closedByClient = false;
  let staticMode = false;
  let cloudMode = false;
  const channel = 'BroadcastChannel' in window
    ? new BroadcastChannel('maqueta6-banca-desarrollo')
    : null;
  const room = roomFromUrl();
  const storageKey = `maqueta6-banca-desarrollo-state:${room}`;
  const cloudEndpoint = `/.netlify/functions/sync-state?room=${encodeURIComponent(room)}`;
  const clientId = clientIdFromStorage();
  let clientSeq = Number(localStorage.getItem('maqueta6-banca-desarrollo-client-seq') || 0);
  const listeners = new Set();
  let lastDeliveredStateSignature = '';
  let lastDeliveredState = null;
  const initialState = {
    segmentId: null,
    instrumentId: null,
    phase: 'idle',
    selectionMode: 'initial',
    completedSegmentIds: [],
    runId: 0,
    updatedAt: Date.now()
  };
  const status = {
    online: false,
    readyState: 'init',
    attempts: 0,
    reconnects: 0,
    reconnectInMs: 0,
    lastOpenAt: null,
    lastCloseAt: null,
    lastMessageAt: null
  };

  function notify() {
    listeners.forEach(fn => fn(status.online, { ...status }));
  }

  function setStatus(patch) {
    Object.assign(status, patch);
    notify();
  }

  function stateSignature(nextState = {}) {
    return JSON.stringify({
      segmentId: nextState.segmentId || null,
      instrumentId: nextState.instrumentId || null,
      phase: nextState.phase || 'idle',
      selectionMode: nextState.selectionMode || 'initial',
      completedSegmentIds: Array.isArray(nextState.completedSegmentIds) ? nextState.completedSegmentIds : [],
      runId: Number(nextState.runId || 0),
      lockedUntil: Number(nextState.lockedUntil || 0),
      nextPhaseAt: Number(nextState.nextPhaseAt || 0)
    });
  }

  function stateRunId(nextState = {}) {
    return Number(nextState.runId || 0);
  }

  function isStaleState(nextState = {}) {
    if (!lastDeliveredState) return false;
    const nextRunId = stateRunId(nextState);
    const currentRunId = stateRunId(lastDeliveredState);
    if (nextRunId < currentRunId) return true;
    return nextRunId === currentRunId
      && lastDeliveredState.phase !== 'idle'
      && nextState.phase === 'idle';
  }

  function deliverState(nextState) {
    if (isStaleState(nextState)) return false;
    const signature = stateSignature(nextState);
    if (signature === lastDeliveredStateSignature) return false;
    lastDeliveredStateSignature = signature;
    lastDeliveredState = { ...nextState };
    onState(nextState);
    return true;
  }

  function connect() {
    clearTimeout(retryTimer);
    if (shouldUseCloudSync()) {
      activateCloudMode();
      return;
    }
    if (staticMode) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    status.attempts += 1;
    setStatus({ readyState: 'connecting', reconnectInMs: 0 });

    socket = new WebSocket(`${protocol}//${location.host}/ws`);

    socket.addEventListener('open', () => {
      setStatus({
        online: true,
        readyState: 'open',
        reconnects: 0,
        reconnectInMs: 0,
        lastOpenAt: Date.now()
      });
    });

    socket.addEventListener('close', () => {
      if (closedByClient) return;
      if (shouldUseCloudSync()) {
        activateCloudMode();
        return;
      }
      const delay = Math.min(3000, 500 * (2 ** Math.min(status.reconnects, 3)));
      setStatus({
        online: false,
        readyState: 'closed',
        reconnects: status.reconnects + 1,
        reconnectInMs: delay,
        lastCloseAt: Date.now()
      });
      retryTimer = setTimeout(connect, delay);
    });

    socket.addEventListener('error', () => {
      setStatus({ online: false, readyState: 'error' });
    });

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        setStatus({ lastMessageAt: Date.now() });
        if (msg.type === 'state') deliverState(msg.state);
      } catch (error) {
        console.warn('Mensaje inválido', error);
      }
    });
  }

  function shouldUseStaticFallback() {
    return !['localhost', '127.0.0.1'].includes(location.hostname);
  }

  function shouldUseCloudSync() {
    return location.hostname === 'maqueta6bid.netlify.app' || location.hostname.endsWith('.netlify.app');
  }

  function roomFromUrl() {
    try {
      const params = new URLSearchParams(location.search);
      const explicitRoom = params.get('room');
      if (explicitRoom) {
        localStorage.setItem('maqueta6-banca-desarrollo-room', explicitRoom);
        return explicitRoom;
      }
      return localStorage.getItem('maqueta6-banca-desarrollo-room') || 'default';
    } catch {
      return 'default';
    }
  }

  function clientIdFromStorage() {
    try {
      const key = 'maqueta6-banca-desarrollo-client-id';
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const next = crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, next);
      return next;
    } catch {
      return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function withCloudOrdering(message) {
    clientSeq += 1;
    try { localStorage.setItem('maqueta6-banca-desarrollo-client-seq', String(clientSeq)); } catch {}
    return {
      ...message,
      room,
      clientId,
      clientSeq,
      sentAt: Date.now()
    };
  }

  function normalizeCompletedIds(ids = []) {
    const normalized = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (id && !normalized.includes(id)) normalized.push(id);
    }
    return normalized;
  }

  function appendCompletedId(current = {}, id) {
    return normalizeCompletedIds([
      ...normalizeCompletedIds(current.completedSegmentIds),
      id
    ]);
  }

  function readStaticState() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || { ...initialState };
    } catch {
      return { ...initialState };
    }
  }

  function writeStaticState(nextState, source = 'static-preview') {
    const state = { ...nextState, updatedAt: Date.now() };
    localStorage.setItem(storageKey, JSON.stringify(state));
    channel?.postMessage({ type: 'state', room, state, source });
    deliverState(state);
  }

  function scheduleStaticRoute(runId) {
    clearTimeout(phaseTimer);
    phaseTimer = setTimeout(() => {
      const current = readStaticState();
      if (current.runId !== runId) return;
      writeStaticState({ ...current, phase: 'route' }, 'static-preview');
      phaseTimer = setTimeout(() => {
        const next = readStaticState();
        if (next.runId !== runId) return;
        writeStaticState({ ...next, phase: 'result' }, 'static-preview');
      }, 2800);
    }, 5500);
  }

  function applyStaticMessage(message) {
    const current = readStaticState();
    const runId = (current.runId || 0) + 1;

    if (message.type === 'reset') {
      clearTimeout(phaseTimer);
      writeStaticState({ ...initialState, runId }, message.source || 'static-preview');
      return true;
    }

    if (message.type === 'selectSegment') {
      clearTimeout(phaseTimer);
      writeStaticState({
        ...current,
        segmentId: message.segmentId,
        instrumentId: null,
        phase: 'problem',
        selectionMode: 'initial',
        completedSegmentIds: normalizeCompletedIds(message.completedSegmentIds ?? current.completedSegmentIds),
        runId
      }, message.source || 'static-preview');
      return true;
    }

    if (message.type === 'completeSegment') {
      writeStaticState({
        ...current,
        completedSegmentIds: message.completedSegmentIds === undefined
          ? appendCompletedId(current, message.segmentId)
          : appendCompletedId({ completedSegmentIds: message.completedSegmentIds }, message.segmentId)
      }, message.source || 'static-preview');
      return true;
    }

    if (message.type === 'showSolutions') {
      clearTimeout(phaseTimer);
      writeStaticState({
        ...current,
        segmentId: message.segmentId || current.segmentId,
        instrumentId: null,
        phase: 'solutions',
        selectionMode: message.comparison ? 'compare' : 'initial',
        completedSegmentIds: appendCompletedId(current, message.segmentId || current.segmentId),
        runId
      }, message.source || 'static-preview');
      return true;
    }

    if (message.type === 'runRoute') {
      writeStaticState({
        ...current,
        segmentId: message.segmentId || current.segmentId,
        instrumentId: message.instrumentId || current.instrumentId,
        phase: 'instrument',
        selectionMode: 'route',
        completedSegmentIds: appendCompletedId(current, message.segmentId || current.segmentId),
        runId
      }, message.source || 'static-preview');
      scheduleStaticRoute(runId);
      return true;
    }

    if (message.type === 'setState' && message.patch) {
      clearTimeout(phaseTimer);
      const lockedUntil = message.patch.lockedUntil !== undefined
        ? Number(message.patch.lockedUntil)
        : message.patch.phase === 'bankIntro'
          ? Date.now() + 31000
          : message.patch.phase === 'closing'
            ? Date.now() + (message.patch.lockedMs !== undefined ? Number(message.patch.lockedMs) : 20000)
            : undefined;
      writeStaticState({ ...current, ...message.patch, lockedUntil, runId }, message.source || 'static-preview');
      return true;
    }

    return false;
  }

  function activateStaticMode() {
    staticMode = true;
    clearTimeout(retryTimer);
    setStatus({
      online: true,
      readyState: 'static-preview',
      reconnectInMs: 0,
      lastOpenAt: Date.now()
    });
    writeStaticState(readStaticState(), 'static-preview');
  }

  function rememberCloudState(state, source = 'cloud') {
    if (isStaleState(state)) return false;
    localStorage.setItem(storageKey, JSON.stringify(state));
    channel?.postMessage({ type: 'state', room, state, source });
    return deliverState(state);
  }

  async function pullCloudState(source = 'cloud') {
    try {
      const response = await fetch(`${cloudEndpoint}&t=${Date.now()}`, {
        cache: 'no-store',
        headers: { accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Cloud sync ${response.status}`);
      const payload = await response.json();
      if (payload?.state) {
        setStatus({
          online: true,
          readyState: 'cloud-sync',
          reconnectInMs: 0,
          lastMessageAt: Date.now()
        });
        rememberCloudState(payload.state, source);
      }
      return payload?.state || null;
    } catch (error) {
      setStatus({
        online: false,
        readyState: 'cloud-error',
        reconnects: status.reconnects + 1,
        reconnectInMs: 700,
        lastCloseAt: Date.now()
      });
      return null;
    }
  }

  function scheduleCloudPoll(delay = 450) {
    clearTimeout(cloudPollTimer);
    if (!cloudMode || closedByClient) return;
    cloudPollTimer = setTimeout(async () => {
      if (cloudPendingSends > 0) {
        scheduleCloudPoll(180);
        return;
      }
      await pullCloudState();
      scheduleCloudPoll(status.online ? 300 : 800);
    }, delay);
  }

  function activateCloudMode() {
    if (cloudMode) return;
    cloudMode = true;
    staticMode = false;
    clearTimeout(retryTimer);
    setStatus({
      online: false,
      readyState: 'cloud-sync',
      reconnectInMs: 0,
      lastOpenAt: Date.now()
    });
    pullCloudState('cloud-initial').then(() => scheduleCloudPoll(350));
  }

  async function postCloudMessage(message) {
    const orderedMessage = withCloudOrdering(message);
    cloudPendingSends += 1;
    clearTimeout(cloudPollTimer);
    setStatus({
      online: true,
      readyState: 'cloud-sending',
      reconnectInMs: 0
    });
    try {
      const response = await fetch(cloudEndpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(orderedMessage)
      });
      if (!response.ok) throw new Error(`Cloud sync ${response.status}`);
      const payload = await response.json();
      if (payload?.state) {
        setStatus({
          online: true,
          readyState: 'cloud-sync',
          reconnectInMs: 0,
          lastMessageAt: Date.now()
        });
        rememberCloudState(payload.state, orderedMessage.source || 'cloud');
      }
    } catch {
      setStatus({
        online: false,
        readyState: 'cloud-error',
        reconnects: status.reconnects + 1,
        reconnectInMs: 700,
        lastCloseAt: Date.now()
      });
    } finally {
      cloudPendingSends = Math.max(0, cloudPendingSends - 1);
      scheduleCloudPoll(cloudPendingSends > 0 ? 180 : 120);
    }
  }

  function sendCloudMessage(message) {
    cloudSendQueue = cloudSendQueue
      .catch(() => {})
      .then(() => postCloudMessage(message));
    return true;
  }

  function send(message) {
    if (cloudMode) return sendCloudMessage(message);
    if (staticMode) return applyStaticMessage(message);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  channel?.addEventListener('message', event => {
    if (event.data?.type !== 'state' || !event.data.state) return;
    if (event.data.room !== room) return;
    deliverState(event.data.state);
  });

  connect();

  return {
    send,
    getStatus() {
      return { ...status };
    },
    close() {
      closedByClient = true;
      clearTimeout(retryTimer);
      clearTimeout(phaseTimer);
      clearTimeout(cloudPollTimer);
      channel?.close();
      socket?.close();
    },
    onConnectionChange(fn) {
      listeners.add(fn);
      fn(status.online, { ...status });
      return () => listeners.delete(fn);
    }
  };
}
