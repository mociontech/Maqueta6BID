import { createExperienceSocket } from '/shared/ws.js';
import { createDiagnosticsPanel } from '/shared/diagnostics.js';

const data = await fetch('/data/experience.json').then(response => response.json());

const routePhases = ['instrument', 'route', 'providers', 'result'];
const phaseLabels = {
  idle: 'Inicio',
  problem: 'Leyendo barrera principal',
  solutions: 'Seleccionando solución',
  instrument: 'Mostrando solución en TV',
  route: 'Iluminando participación',
  providers: 'Entidades participantes',
  result: 'Resultado en pantalla'
};
const phaseProgress = {
  idle: 0,
  problem: 28,
  solutions: 46,
  instrument: 62,
  route: 78,
  providers: 92,
  result: 100
};
const segmentMarks = {
  financialInstitutions: 'landmark',
  privateSector: 'building-2',
  peopleMsmEs: 'house'
};
const instrumentMarks = {
  financing: 'banknote',
  guarantees: 'shield-check',
  insurance: 'umbrella',
  capital: 'chart-no-axes-combined'
};

let state = { segmentId: null, instrumentId: null, phase: 'idle', selectionMode: 'initial', runId: 0 };
let localSegment = null;

const els = {
  shell: document.querySelector('.tablet-shell'),
  connection: document.querySelector('#connection'),
  resetGlobal: document.querySelector('#resetGlobal'),
  routeLabel: document.querySelector('#routeLabel'),
  phaseLabel: document.querySelector('#phaseLabel'),
  routeMeter: document.querySelector('#routeMeter'),
  segments: document.querySelector('#segments'),
  instruments: document.querySelector('#instruments'),
  segmentStep: document.querySelector('#segmentStep'),
  problemStep: document.querySelector('#problemStep'),
  solutionStep: document.querySelector('#solutionStep'),
  runningStep: document.querySelector('#runningStep'),
  problemTitle: document.querySelector('#problemTitle'),
  problemCopy: document.querySelector('#problemCopy'),
  selectedSegment: document.querySelector('#selectedSegment'),
  selectedBarrier: document.querySelector('#selectedBarrier'),
  runningTitle: document.querySelector('#runningTitle'),
  runningCopy: document.querySelector('#runningCopy'),
  backFromProblem: document.querySelector('#backFromProblem'),
  backToProblem: document.querySelector('#backToProblem'),
  readProblem: document.querySelector('#readProblem'),
  newInstrument: document.querySelector('#newInstrument'),
  changeSector: document.querySelector('#changeSector'),
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
  return 'Sin conexión';
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

function segmentAccent(id) {
  return ({
    financialInstitutions: '#2e7de9',
    privateSector: '#32c7c9',
    peopleMsmEs: '#f08a24'
  })[id] || '#58ddff';
}

function currentSegment() {
  return data.segments.find(item => item.id === (localSegment || state.segmentId));
}

function currentInstrument() {
  return data.instruments.find(item => item.id === state.instrumentId);
}

function solutionFor(segment, instrumentId) {
  const configured = segment?.solutions?.[instrumentId];
  if (!configured) return null;
  return typeof configured === 'string'
    ? { solution: configured, description: configured, targetActorIds: [] }
    : configured;
}

function createButton(className, label, iconName) {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  const icon = document.createElement('span');
  icon.className = 'pictogram';
  icon.style.setProperty('--icon', `url('/assets/icons/${iconName}.svg')`);
  const content = document.createElement('span');
  content.className = 'button-copy';
  const strong = document.createElement('strong');
  strong.textContent = label;
  content.append(strong);
  button.append(icon, content);
  return { button, content };
}

function renderSegments() {
  els.segments.innerHTML = '';
  for (const segment of data.segments) {
    const { button, content } = createButton('segment-card', segment.label, segmentMarks[segment.id]);
    button.dataset.id = segment.id;
    button.style.setProperty('--accent', segmentAccent(segment.id));
    const small = document.createElement('small');
    small.textContent = segment.primaryBarrier;
    content.append(small);
    const preview = document.createElement('img');
    preview.className = 'segment-preview';
    preview.src = segment.asset;
    preview.alt = '';
    button.append(preview);
    button.addEventListener('click', () => chooseSegment(segment.id));
    els.segments.append(button);
  }
}

function providerNames(segment, instrument) {
  const solution = solutionFor(segment, instrument.id);
  const names = (solution?.targetActorIds || [])
    .map(id => data.providers.find(provider => provider.id === id)?.short)
    .filter(Boolean);
  return names.length ? names.join(' + ') : 'Participación privada por validar';
}

function renderInstruments(segment) {
  els.instruments.innerHTML = '';
  if (!segment) return;

  for (const instrument of data.instruments) {
    const available = segment.allowedInstruments.includes(instrument.id);
    const solution = solutionFor(segment, instrument.id);
    const { button, content } = createButton('instrument-card', instrument.label, instrumentMarks[instrument.id]);
    button.dataset.id = instrument.id;
    button.style.setProperty('--accent', instrument.color);
    button.disabled = !available;
    button.classList.toggle('disabled', !available);
    const provider = document.createElement('em');
    provider.textContent = available ? providerNames(segment, instrument) : 'No disponible para este segmento';
    const small = document.createElement('small');
    small.textContent = solution?.solution || instrument.short;
    content.append(provider, small);
    if (available) button.addEventListener('click', () => chooseInstrument(instrument.id));
    els.instruments.append(button);
  }
}

function showStep(which) {
  els.shell.dataset.step = which.id;
  for (const step of [els.segmentStep, els.problemStep, els.solutionStep, els.runningStep]) {
    step.classList.toggle('active', step === which);
  }
}

function setRouteStatus() {
  const segment = data.segments.find(item => item.id === state.segmentId);
  const instrument = data.instruments.find(item => item.id === state.instrumentId);
  const phase = state.phase || 'idle';
  els.phaseLabel.textContent = phaseLabels[phase] || 'Experiencia';
  els.routeMeter.style.width = `${phaseProgress[phase] ?? 0}%`;

  if (segment && instrument) {
    els.routeLabel.textContent = `${segment.shortLabel} · ${instrument.label}`;
  } else if (segment) {
    els.routeLabel.textContent = segment.shortLabel;
  } else {
    els.routeLabel.textContent = 'Selecciona una zona';
  }
}

function setProblem(segment) {
  localSegment = segment?.id || null;
  els.problemTitle.textContent = segment?.label || '';
  els.problemCopy.textContent = segment?.primaryBarrier || '';
  els.selectedSegment.textContent = segment?.label || '';
  els.selectedBarrier.textContent = segment?.primaryBarrier || '';
  document.querySelectorAll('.segment-card').forEach(button => {
    button.classList.toggle('selected', button.dataset.id === segment?.id);
  });
}

function chooseSegment(id) {
  const segment = data.segments.find(item => item.id === id);
  if (!segment) return;
  state = { ...state, segmentId: id, instrumentId: null, phase: 'problem' };
  setProblem(segment);
  setRouteStatus();
  showStep(els.problemStep);
  socket.send({ type: 'selectSegment', source: 'controller', segmentId: id });
}

function showSolutions(comparison = false) {
  const segment = currentSegment();
  if (!segment) return;
  state = {
    ...state,
    segmentId: segment.id,
    instrumentId: null,
    phase: 'solutions',
    selectionMode: comparison ? 'compare' : 'initial'
  };
  setProblem(segment);
  renderInstruments(segment);
  setRouteStatus();
  showStep(els.solutionStep);
  socket.send({
    type: 'showSolutions',
    source: 'controller',
    segmentId: segment.id,
    comparison
  });
}

function chooseInstrument(id) {
  const segment = currentSegment();
  if (!segment || !segment.allowedInstruments.includes(id)) return;
  const instrument = data.instruments.find(item => item.id === id);
  if (!instrument) return;

  state = { ...state, segmentId: segment.id, instrumentId: id, phase: 'instrument' };
  setRunningCopy(segment, instrument);
  setRouteStatus();
  showStep(els.runningStep);
  socket.send({ type: 'runRoute', source: 'controller', segmentId: segment.id, instrumentId: id });
}

function setRunningCopy(segment, instrument) {
  const solution = solutionFor(segment, instrument.id);
  els.runningTitle.textContent = `${segment.shortLabel} · ${instrument.label}`;
  els.runningCopy.innerHTML = `
    <strong>${escapeHtml(solution?.solution || instrument.short)}</strong>
    ${solution?.plainMeaning ? `<em>${escapeHtml(solution.plainMeaning)}</em>` : ''}
    <span>${escapeHtml(providerNames(segment, instrument))}</span>
  `;
}

function syncFromServer() {
  setRouteStatus();

  if (state.phase === 'idle') {
    localSegment = null;
    document.querySelectorAll('.segment-card').forEach(button => button.classList.remove('selected'));
    showStep(els.segmentStep);
    return;
  }

  const segment = data.segments.find(item => item.id === state.segmentId);
  const instrument = data.instruments.find(item => item.id === state.instrumentId);

  if (state.phase === 'problem' && segment) {
    setProblem(segment);
    showStep(els.problemStep);
    return;
  }

  if (state.phase === 'solutions' && segment) {
    setProblem(segment);
    renderInstruments(segment);
    showStep(els.solutionStep);
    return;
  }

  if (segment && instrument && routePhases.includes(state.phase)) {
    localSegment = segment.id;
    setRunningCopy(segment, instrument);
    showStep(els.runningStep);
  }
}

function resetExperience() {
  localSegment = null;
  socket.send({ type: 'reset', source: 'controller' });
}

els.backFromProblem.addEventListener('click', resetExperience);
els.backToProblem.addEventListener('click', () => {
  const segment = currentSegment();
  if (!segment) return resetExperience();
  setProblem(segment);
  state = { ...state, phase: 'problem', instrumentId: null };
  setRouteStatus();
  showStep(els.problemStep);
  socket.send({ type: 'selectSegment', source: 'controller', segmentId: segment.id });
});
els.readProblem.addEventListener('click', () => showSolutions(false));
els.resetGlobal.addEventListener('click', resetExperience);
els.restart.addEventListener('click', resetExperience);
els.changeSector.addEventListener('click', resetExperience);
els.newInstrument.addEventListener('click', () => showSolutions(true));

createDiagnosticsPanel({
  title: 'Diagnóstico tablet',
  socket,
  getRows: () => [
    ['Fase', state.phase || 'idle'],
    ['Run ID', String(state.runId || 0)],
    ['Zona', state.segmentId || 'ninguna'],
    ['Instrumento', state.instrumentId || 'ninguno']
  ]
});

renderSegments();
setRouteStatus();
