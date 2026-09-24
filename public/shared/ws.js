export function createExperienceSocket(onState) {
  let socket;
  let retryTimer;
  let phaseTimer;
  let closedByClient = false;
  let staticMode = false;
  const channel = 'BroadcastChannel' in window
    ? new BroadcastChannel('maqueta6-banca-desarrollo')
    : null;
  const storageKey = 'maqueta6-banca-desarrollo-state';
  const listeners = new Set();
  const initialState = {
    segmentId: null,
    instrumentId: null,
    phase: 'idle',
    selectionMode: 'initial',
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

  function connect() {
    clearTimeout(retryTimer);
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
      if (shouldUseStaticFallback()) {
        activateStaticMode();
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
        if (msg.type === 'state') onState(msg.state);
      } catch (error) {
        console.warn('Mensaje inválido', error);
      }
    });
  }

  function shouldUseStaticFallback() {
    return !['localhost', '127.0.0.1'].includes(location.hostname);
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
    channel?.postMessage({ type: 'state', state, source });
    onState(state);
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
        runId
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
        runId
      }, message.source || 'static-preview');
      scheduleStaticRoute(runId);
      return true;
    }

    if (message.type === 'setState' && message.patch) {
      clearTimeout(phaseTimer);
      const lockedUntil = message.patch.lockedUntil || (
        message.patch.phase === 'bankIntro'
          ? Date.now() + 31000
          : message.patch.phase === 'closing'
            ? Date.now() + Number(message.patch.lockedMs || 20000)
            : undefined
      );
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

  function send(message) {
    if (staticMode) return applyStaticMessage(message);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  channel?.addEventListener('message', event => {
    if (event.data?.type === 'state' && event.data.state) onState(event.data.state);
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
