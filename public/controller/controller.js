import { createExperienceSocket } from '/shared/ws.js';
import { createDiagnosticsPanel } from '/shared/diagnostics.js';

const data = await fetch('/data/experience.json').then(response => response.json());

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

let state = { segmentId: null, instrumentId: null, phase: 'idle', selectionMode: 'initial', runId: 0 };
let selectedSectorId = null;
let autoRunTimer = null;
let localFinal = false;

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
  exploreAgain: document.querySelector('#exploreAgain'),
  restart: document.querySelector('#restart')
};

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
}

function clearAutoRun() {
  if (!autoRunTimer) return;
  clearTimeout(autoRunTimer);
  autoRunTimer = null;
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
    const instrument = currentInstrument(sector);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sector-card';
    button.dataset.id = sector.id;
    button.style.setProperty('--accent', color);
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    const detail = document.createElement('small');
    title.textContent = sector.label;
    detail.textContent = instrument?.label || 'Solucion BD';
    copy.append(title, detail);
    button.append(iconSpan(sector.icon, color), copy);
    button.addEventListener('click', () => chooseSector(sector.id));
    els.sectors.append(button);
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
  els.phaseLabel.textContent = phaseLabels[phase] || 'Experiencia en curso';
  els.routeMeter.style.width = `${phaseProgress[phase] ?? 0}%`;
}

function goToIntro(reset = true) {
  clearAutoRun();
  selectedSectorId = null;
  showStep(els.introStep, 'intro');
  if (reset) socket.send({ type: 'reset', source: 'controller' });
}

function goToSectors(resetDisplay = false) {
  clearAutoRun();
  selectedSectorId = null;
  showStep(els.sectorStep, 'sectors');
  if (resetDisplay) {
    socket.send({ type: 'reset', source: 'controller' });
    setTimeout(() => {
      socket.send({
        type: 'setState',
        source: 'controller',
        patch: { phase: 'bankIntro', segmentId: null, instrumentId: null, selectionMode: 'initial' }
      });
    }, 120);
  }
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
  const sector = currentSector(id);
  if (!sector) return;
  clearAutoRun();
  selectedSectorId = sector.id;
  state = {
    ...state,
    segmentId: sector.id,
    instrumentId: null,
    phase: 'problem'
  };
  setSelectedSummary(sector);
  setRouteStatus();
  showStep(els.activeStep, 'active');
  socket.send({ type: 'selectSegment', source: 'controller', segmentId: sector.id });
  autoRunTimer = setTimeout(() => runSelectedSector(sector), autoRunDelayMs);
}

function finishExperience() {
  clearAutoRun();
  socket.send({
    type: 'setState',
    source: 'controller',
    patch: { phase: 'closing' }
  });
  showStep(els.finalStep, 'final');
}

function syncFromServer() {
  setRouteStatus();
  if (localFinal) return;

  if (state.phase === 'idle' && els.shell.dataset.step !== 'sectors') {
    selectedSectorId = null;
    showStep(els.introStep, 'intro');
    return;
  }

  if (state.phase === 'bankIntro') {
    showStep(els.sectorStep, 'sectors');
    return;
  }

  if (state.phase === 'closing') {
    showStep(els.finalStep, 'final');
    return;
  }

  const sector = currentSector(state.segmentId);
  if (sector && state.phase !== 'idle') {
    selectedSectorId = sector.id;
    setSelectedSummary(sector);
    showStep(els.activeStep, 'active');
  }
}

els.begin.addEventListener('click', () => goToSectors(true));
els.backHome.addEventListener('click', () => goToIntro(true));
els.goHome.addEventListener('click', () => goToIntro(true));
els.newSector.addEventListener('click', () => goToSectors(false));
els.changeSector.addEventListener('click', () => goToSectors(true));
els.finish.addEventListener('click', finishExperience);
els.exploreAgain.addEventListener('click', () => goToSectors(false));
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
