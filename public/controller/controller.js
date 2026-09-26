import { createExperienceSocket } from '/shared/ws.js';
import { createDiagnosticsPanel } from '/shared/diagnostics.js';

const data = await fetch('/data/experience.json').then(response => response.json());
const staticStateStorageKey = 'maqueta6-banca-desarrollo-state';
const isStaticHost = !['localhost', '127.0.0.1'].includes(location.hostname);
const isReloadNavigation = performance.getEntriesByType('navigation')?.[0]?.type === 'reload';

if (isStaticHost && isReloadNavigation) {
  resetStaticReloadState();
}

const phaseLabels = {
  idle: 'Inicio',
  bankIntro: 'Elige un actor',
  problem: 'Mostrando barrera de acceso',
  solutions: 'Mostrando barrera de acceso',
  instrument: 'Banca de Desarrollo activada',
  route: 'Activando sector privado',
  providers: 'Activando sector privado',
  result: 'Transformacion en pantalla',
  closing: 'Experiencia finalizada'
};
const phaseProgress = {
  idle: 0,
  bankIntro: 16,
  problem: 22,
  solutions: 22,
  instrument: 52,
  route: 78,
  providers: 86,
  result: 100,
  closing: 100
};
const autoRunDelayMs = 1200;
const mandatoryIntroLockMs = data.animationTimings?.mandatoryIntroLockMs || 24000;
const transformationLockMs = data.animationTimings?.transformationLockMs || 12000;
const sectorOrder = data.segments.map(segment => segment.id);
const sectorLabelAssets = {
  intermediaries: '/pantallas/INTERMEDIARIOS.png',
  investors: '/pantallas/INVERSIONISTAS.png',
  insurers: '/pantallas/ASEGURADORAS.png'
};

let state = { segmentId: null, instrumentId: null, phase: 'idle', selectionMode: 'initial', runId: 0, lockedUntil: 0 };
let selectedSectorId = null;
let autoRunTimer = null;
let sectorReadTimer = null;
const completedSectors = new Set();
let localFinal = false;
let lockTimer = null;

const els = {
  shell: document.querySelector('.tablet-shell'),
  connection: document.querySelector('#connection'),
  resetGlobal: document.querySelector('#resetGlobal'),
  introStep: document.querySelector('#introStep'),
  sectorStep: document.querySelector('#sectorStep'),
  activeStep: document.querySelector('#activeStep'),
  finalStep: document.querySelector('#finalStep'),
  introTitle: document.querySelector('#introTitle'),
  introCopy: document.querySelector('#introCopy'),
  sectorTitle: document.querySelector('#sectorTitle'),
  sectorCopy: document.querySelector('#sectorCopy'),
  activeTitle: document.querySelector('#activeTitle'),
  activeCopy: document.querySelector('#activeCopy'),
  finalTitle: document.querySelector('#finalTitle'),
  finalCopy: document.querySelector('#finalCopy'),
  sectors: document.querySelector('#sectors'),
  selectedSummary: document.querySelector('#selectedSummary'),
  phaseLabel: document.querySelector('#phaseLabel'),
  routeMeter: document.querySelector('#routeMeter'),
  begin: document.querySelector('#begin'),
  backHome: document.querySelector('#backHome'),
  goHome: document.querySelector('#goHome'),
  newSector: document.querySelector('#newSector'),
  changeSector: document.querySelector('#changeSector'),
  finish: document.querySelector('#finish'),
  viewTransformation: document.querySelector('#viewTransformation'),
  exploreAgain: document.querySelector('#exploreAgain'),
  restart: document.querySelector('#restart')
};
els.activeActions = els.activeStep.querySelector('.action-stack');

const socket = createExperienceSocket(next => {
  state = next;
  syncFromServer();
});

socket.onConnectionChange((online, wsStatus) => {
  els.connection.textContent = online ? 'TV conectada' : retryLabel(wsStatus);
  els.connection.classList.toggle('online', online);
});

function retryLabel(wsStatus) {
  if (wsStatus?.reconnectInMs) return `Reconectando ${Math.round(wsStatus.reconnectInMs / 1000)} s`;
  return 'Sin conexion';
}

function resetStaticReloadState() {
  try {
    const previous = JSON.parse(localStorage.getItem(staticStateStorageKey) || '{}');
    const now = Date.now();
    localStorage.setItem(staticStateStorageKey, JSON.stringify({
      segmentId: null,
      instrumentId: null,
      phase: 'bankIntro',
      selectionMode: 'initial',
      runId: Number(previous.runId || 0) + 1,
      lockedUntil: now,
      updatedAt: now
    }));
  } catch {
    // If storage is unavailable, the socket fallback will use its clean initial state.
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function sectorColor(id) {
  return ({
    intermediaries: '#4f9dff',
    investors: '#d3bb62',
    insurers: '#f28a30'
  })[id] || '#53e0c7';
}

function currentSector(id = selectedSectorId || state.segmentId) {
  return data.segments.find(item => item.id === id);
}

function mappedInstrumentId(sector) {
  return sector?.mappedInstrumentId || sector?.allowedInstruments?.[0] || null;
}

function currentInstrument(sector = currentSector()) {
  const id = state.instrumentId || mappedInstrumentId(sector);
  return data.instruments.find(item => item.id === id);
}

function solutionFor(sector, instrumentId = mappedInstrumentId(sector)) {
  const configured = sector?.solutions?.[instrumentId];
  if (!configured) return null;
  return typeof configured === 'string'
    ? { solution: configured, description: configured, targetActorIds: [] }
    : configured;
}

function iconSpan(iconName, color) {
  const icon = document.createElement('span');
  icon.className = 'pictogram';
  icon.style.setProperty('--icon', `url('/assets/icons/${iconName}.svg')`);
  icon.style.setProperty('--accent', color);
  return icon;
}

function showStep(step, name) {
  localFinal = step === els.finalStep;
  els.shell.dataset.step = name;
  for (const item of [els.introStep, els.sectorStep, els.activeStep, els.finalStep]) {
    item.classList.toggle('active', item === step);
  }
  updateInteractionLock();
}

function clearAutoRun() {
  if (!autoRunTimer) return;
  clearTimeout(autoRunTimer);
  autoRunTimer = null;
}

function clearSectorReadTimer() {
  if (!sectorReadTimer) return;
  clearTimeout(sectorReadTimer);
  sectorReadTimer = null;
}

function setTextFromData() {
  els.introTitle.textContent = data.meta.introTitle || 'El rol de la banca de desarrollo';
  els.introCopy.textContent = data.meta.introCopy || '';
  els.sectorTitle.textContent = data.meta.selectionTitle || 'Explora soluciones';
  els.sectorCopy.textContent = data.meta.selectionCopy || '';
  els.activeTitle.textContent = data.meta.activationTitle || 'Banca de Desarrollo activada';
  els.activeCopy.textContent = data.meta.activationCopy || '';
  els.finalTitle.textContent = data.meta.finalTitle || 'Gracias por participar';
  els.finalCopy.textContent = data.meta.finalCopy || '';
}

function renderSectors() {
  els.sectors.innerHTML = '';
  for (const sector of data.segments) {
    const color = sectorColor(sector.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sector-card';
    button.dataset.id = sector.id;
    button.style.setProperty('--accent', color);
    button.setAttribute('aria-label', sector.shortLabel || sector.label);
    const label = document.createElement('img');
    label.className = 'sector-label';
    label.src = sectorLabelAssets[sector.id] || '';
    label.alt = '';
    label.draggable = false;
    const accessibleText = document.createElement('span');
    accessibleText.className = 'sr-only';
    accessibleText.textContent = sector.shortLabel || sector.label;
    button.append(label, accessibleText);
    button.addEventListener('click', () => chooseSector(sector.id));
    els.sectors.append(button);
  }
  updateSectorGuidance();
}

function nextPendingSectorId() {
  return sectorOrder.find(id => !completedSectors.has(id)) || sectorOrder[0] || null;
}

function updateSectorGuidance(activeId = selectedSectorId, waiting = false) {
  const allCompleted = sectorOrder.length > 0 && sectorOrder.every(id => completedSectors.has(id));
  const nextId = waiting || allCompleted ? null : nextPendingSectorId();
  els.shell.dataset.impactReady = allCompleted ? 'true' : 'false';
  els.shell.dataset.hasSectorSelection = completedSectors.size > 0 ? 'true' : 'false';
  els.sectors.querySelectorAll('.sector-card').forEach(button => {
    const id = button.dataset.id;
    const isSelected = id === activeId;
    const isCompleted = completedSectors.has(id);
    button.classList.toggle('selected', isSelected);
    button.classList.toggle('completed', isCompleted);
    button.classList.toggle('dimmed', isCompleted && !isSelected);
    button.classList.toggle('recommended', Boolean(nextId) && id === nextId && id !== activeId);
  });
  if (els.viewTransformation) {
    els.viewTransformation.hidden = !allCompleted;
    els.viewTransformation.textContent = 'VER IMPACTO';
    els.viewTransformation.setAttribute('aria-label', 'Ver impacto');
  }
}

function setSelectedSummary(sector) {
  const instrument = currentInstrument(sector);
  const solution = solutionFor(sector, instrument?.id);
  const color = sectorColor(sector?.id);
  els.selectedSummary.style.setProperty('--accent', color);
  els.selectedSummary.innerHTML = `
    <strong>${escapeHtml(sector?.label || '')}</strong>
    <em>${escapeHtml(instrument?.label || 'Solucion BD')}</em>
    <span>${escapeHtml(solution?.plainMeaning || solution?.solution || '')}</span>
  `;
}

function setRouteStatus() {
  const phase = state.phase || 'idle';
  els.shell.dataset.phase = phase;
  const remainingSeconds = Math.ceil(lockRemainingMs() / 1000);
  els.phaseLabel.textContent = remainingSeconds > 0
    ? `Observa la maqueta (${remainingSeconds} s)`
    : phaseLabels[phase] || 'Experiencia en curso';
  els.routeMeter.style.width = `${phaseProgress[phase] ?? 0}%`;
}

function lockRemainingMs() {
  return Math.max(0, Number(state.lockedUntil || 0) - Date.now());
}

function isInteractionLocked() {
  return lockRemainingMs() > 0;
}

function updateInteractionLock() {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }

  const locked = isInteractionLocked();
  const waitingIntro = state.phase === 'bankIntro' && els.shell.dataset.step === 'active';
  els.shell.dataset.locked = locked ? 'true' : 'false';
  els.shell.dataset.waitingIntro = waitingIntro ? 'true' : 'false';
  if (els.activeActions) els.activeActions.hidden = waitingIntro;
  const controls = [
    els.resetGlobal,
    els.begin,
    els.backHome,
    els.goHome,
    els.changeSector,
    els.finish,
    els.viewTransformation,
    els.exploreAgain,
    els.restart,
    ...els.sectors.querySelectorAll('button')
  ].filter(Boolean);

  for (const control of controls) {
    control.disabled = locked;
    control.setAttribute('aria-disabled', locked ? 'true' : 'false');
  }

  if (locked) {
    lockTimer = setTimeout(() => {
      setRouteStatus();
      updateInteractionLock();
      if (!isInteractionLocked() && state.phase === 'bankIntro' && els.shell.dataset.step === 'active' && !localFinal) {
        showStep(els.sectorStep, 'sectors');
      }
      if (!isInteractionLocked() && state.phase === 'closing' && els.shell.dataset.step === 'active' && !localFinal) {
        showStep(els.finalStep, 'final');
      }
    }, Math.min(lockRemainingMs(), 1000));
  } else if (waitingIntro && !localFinal) {
    showStep(els.sectorStep, 'sectors');
  } else if (state.phase === 'closing' && els.shell.dataset.step === 'active' && !localFinal) {
    showStep(els.finalStep, 'final');
  }
}

function shouldIgnoreInteraction() {
  if (!isInteractionLocked()) return false;
  setRouteStatus();
  updateInteractionLock();
  return true;
}

function goToIntro(reset = true) {
  if (shouldIgnoreInteraction()) return;
  clearAutoRun();
  clearSectorReadTimer();
  completedSectors.clear();
  selectedSectorId = null;
  showStep(els.introStep, 'intro');
  if (reset) socket.send({ type: 'reset', source: 'controller' });
}

function goToSectors(resetDisplay = false) {
  if (shouldIgnoreInteraction()) return;
  clearAutoRun();
  clearSectorReadTimer();
  selectedSectorId = null;
  if (resetDisplay) {
    const lockedUntil = Date.now() + mandatoryIntroLockMs;
    state = {
      ...state,
      phase: 'bankIntro',
      segmentId: null,
      instrumentId: null,
      selectionMode: 'initial',
      lockedUntil
    };
    setRouteStatus();
    showStep(els.activeStep, 'active');
    updateInteractionLock();
    socket.send({
      type: 'setState',
      source: 'controller',
      patch: { phase: 'bankIntro', segmentId: null, instrumentId: null, selectionMode: 'initial', lockedUntil }
    });
    return;
  }

  showStep(els.sectorStep, 'sectors');
  updateSectorGuidance(null);
}

function runSelectedSector(sector) {
  const instrumentId = mappedInstrumentId(sector);
  if (!sector || !instrumentId) return;
  socket.send({
    type: 'runRoute',
    source: 'controller',
    segmentId: sector.id,
    instrumentId
  });
}

function chooseSector(id) {
  if (shouldIgnoreInteraction()) return;
  const sector = currentSector(id);
  if (!sector) return;
  clearAutoRun();
  clearSectorReadTimer();
  selectedSectorId = sector.id;
  completedSectors.add(sector.id);
  state = {
    ...state,
    segmentId: sector.id,
    instrumentId: null,
    phase: 'problem'
  };
  setRouteStatus();
  showStep(els.sectorStep, 'sectors');
  updateSectorGuidance(sector.id);
  socket.send({ type: 'selectSegment', source: 'controller', segmentId: sector.id });
}

function finishExperience() {
  if (shouldIgnoreInteraction()) return;
  clearAutoRun();
  clearSectorReadTimer();
  socket.send({
    type: 'setState',
    source: 'controller',
    patch: { phase: 'closing' }
  });
  showStep(els.finalStep, 'final');
}

function viewTransformation() {
  if (shouldIgnoreInteraction()) return;
  clearAutoRun();
  clearSectorReadTimer();
  state = {
    ...state,
    phase: 'closing',
    lockedUntil: Date.now() + transformationLockMs
  };
  setRouteStatus();
  showStep(els.activeStep, 'active');
  updateInteractionLock();
  socket.send({
    type: 'setState',
    source: 'controller',
    patch: { phase: 'closing', selectionMode: 'transformation', lockedMs: transformationLockMs }
  });
}

function viewFullInfo() {
  if (shouldIgnoreInteraction()) return;
  clearAutoRun();
  clearSectorReadTimer();
  state = {
    ...state,
    phase: 'closing',
    selectionMode: 'fullInfo',
    lockedUntil: Date.now()
  };
  setRouteStatus();
  showStep(els.finalStep, 'final');
  updateInteractionLock();
  socket.send({
    type: 'setState',
    source: 'controller',
    patch: { phase: 'closing', selectionMode: 'fullInfo', lockedMs: 0, lockedUntil: Date.now() }
  });
}

function syncFromServer() {
  setRouteStatus();
  updateInteractionLock();
  if (localFinal) return;

  if (state.phase === 'idle' && els.shell.dataset.step !== 'sectors') {
    selectedSectorId = null;
    showStep(els.introStep, 'intro');
    return;
  }

  if (state.phase === 'bankIntro') {
    showStep(isInteractionLocked() ? els.activeStep : els.sectorStep, isInteractionLocked() ? 'active' : 'sectors');
    if (!isInteractionLocked()) updateSectorGuidance(null);
    return;
  }

  if (state.phase === 'closing') {
    showStep(isInteractionLocked() ? els.activeStep : els.finalStep, isInteractionLocked() ? 'active' : 'final');
    return;
  }

  const sector = currentSector(state.segmentId);
  if (sector && (state.phase === 'problem' || state.phase === 'solutions')) {
    selectedSectorId = sector.id;
    showStep(els.sectorStep, 'sectors');
    updateSectorGuidance(sector.id, true);
    return;
  }

  if (sector && state.phase !== 'idle') {
    selectedSectorId = sector.id;
    setSelectedSummary(sector);
    showStep(els.activeStep, 'active');
  }
}

els.begin.addEventListener('click', () => goToSectors(true));
els.backHome.addEventListener('click', () => goToIntro(true));
els.goHome.addEventListener('click', () => goToIntro(true));
els.newSector?.addEventListener('click', () => goToSectors(false));
els.changeSector.addEventListener('click', () => goToSectors(true));
els.finish.addEventListener('click', finishExperience);
els.viewTransformation?.addEventListener('click', viewTransformation);
els.exploreAgain.addEventListener('click', viewFullInfo);
els.restart.addEventListener('click', () => goToIntro(true));
els.resetGlobal.addEventListener('click', () => goToIntro(true));

createDiagnosticsPanel({
  title: 'Diagnostico tablet',
  socket,
  getRows: () => [
    ['Fase', state.phase || 'idle'],
    ['Run ID', String(state.runId || 0)],
    ['Sector', state.segmentId || selectedSectorId || 'ninguno'],
    ['Instrumento', state.instrumentId || mappedInstrumentId(currentSector()) || 'ninguno']
  ]
});

setTextFromData();
renderSectors();
setRouteStatus();
updateInteractionLock();
