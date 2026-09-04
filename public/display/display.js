import { createExperienceSocket } from '/shared/ws.js';
import { createDiagnosticsPanel } from '/shared/diagnostics.js';

const response = await fetch('/data/experience.json');
if (!response.ok) throw new Error('No se pudo cargar data/experience.json');
const data = await response.json();

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const PHASE_COPY = {
  idle: ['INICIO', 'Selecciona un segmento en la tablet'],
  problem: ['PASO 1', 'Selección del segmento'],
  solutions: ['PASO 2', 'Soluciones propuestas'],
  instrument: ['PASO 3', 'Solución seleccionada'],
  route: ['PASO 4', 'Participación activada'],
  providers: ['PASO 4', 'Entidades iluminadas'],
  result: ['PASO 4', 'Resultado']
};
const routePhases = new Set(['instrument', 'route', 'providers', 'result']);
const actorVisualStates = new Set(['disabled', 'idle', 'available', 'active']);

let state = {
  phase: 'idle',
  selectionMode: 'initial',
  runId: 0,
  segmentId: null,
  instrumentId: null
};
let sequenceToken = 0;
let sequenceTimers = [];
let sequenceFrames = [];
let sequenceAnimations = [];

const els = {
  shell: document.querySelector('.display-shell'),
  stepBadge: document.querySelector('#stepBadge'),
  stepTitle: document.querySelector('#stepTitle'),
  connection: document.querySelector('#connectionStatus'),
  segmentRail: document.querySelector('#segmentRail'),
  instrumentRail: document.querySelector('#instrumentRail'),
  railHint: document.querySelector('#railHint'),
  segments: document.querySelector('#segmentNodes'),
  actors: document.querySelector('#actorNodes'),
  rings: document.querySelector('#instrumentRings'),
  bid: document.querySelector('#bidPuck'),
  developmentBankTitle: document.querySelector('#developmentBankTitle'),
  annotation: document.querySelector('#annotation'),
  routeMarker: document.querySelector('#routeMarker'),
  particles: [...document.querySelectorAll('.route-particle')]
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}

function iconMarkup(name, className = 'ui-icon') {
  return `<span class="${className}" style="--icon:url('/assets/icons/${escapeHtml(name)}.svg')" aria-hidden="true"></span>`;
}

function findSegment(id = state.segmentId) {
  return data.segments.find(segment => segment.id === id);
}

function findInstrument(id = state.instrumentId) {
  return data.instruments.find(instrument => instrument.id === id);
}

function findProvider(id) {
  return data.providers.find(provider => provider.id === id);
}

function getSolution(segment, instrument) {
  if (!segment || !instrument) return null;
  const configured = segment.solutions?.[instrument.id];
  if (!configured) return null;
  if (typeof configured === 'string') {
    return {
      enabled: true,
      solution: configured,
      description: configured,
      targetActorIds: [],
      results: [],
      mappingStatus: 'pending-client-validation'
    };
  }
  return configured;
}

function buildScene() {
  const house = data.meta.developmentBankHouse;
  els.developmentBankTitle.textContent = house.title;
  els.segments.innerHTML = data.segments.map(segment => `
    <article class="segment-node" data-id="${escapeHtml(segment.id)}" data-state="idle" style="--node-color:#4f9dff">
      <div class="node-label">
        ${iconMarkup(segment.icon)}
        <strong>${escapeHtml(segment.shortLabel)}</strong>
      </div>
      <img class="node-art" src="${escapeHtml(segment.asset)}" alt="" />
    </article>
  `).join('');

  els.actors.innerHTML = data.providers.map(provider => `
    <article class="actor-node" data-id="${escapeHtml(provider.id)}" data-state="idle" style="--node-color:#4f9dff">
      <div class="node-label">
        ${iconMarkup(provider.icon)}
        <strong>${escapeHtml(provider.label)}</strong>
      </div>
      <p class="actor-role" hidden></p>
      <img class="node-art" src="${escapeHtml(provider.asset)}" alt="" />
    </article>
  `).join('');

  els.rings.innerHTML = data.instruments.map(instrument => `
    <div class="instrument-ring" data-id="${escapeHtml(instrument.id)}" style="--ring-color:${escapeHtml(instrument.color)}">
      <span class="ring-label">${escapeHtml(instrument.label)}</span>
    </div>
  `).join('');
}

function renderRail(segment, instrument) {
  const instrumentPanel = els.instrumentRail.closest('.rail-panel');
  instrumentPanel.hidden = !segment || state.phase === 'problem';
  els.segmentRail.innerHTML = data.segments.map(item => {
    const active = item.id === segment?.id;
    return `
      <div class="rail-item available ${active ? 'active' : ''}" style="--item-color:#4f9dff">
        ${iconMarkup(item.icon)}
        <strong>${escapeHtml(item.shortLabel)}</strong>
        <span class="rail-state">${active ? '✓' : ''}</span>
      </div>
    `;
  }).join('');

  els.instrumentRail.innerHTML = data.instruments.map(item => {
    const available = Boolean(segment?.allowedInstruments.includes(item.id));
    const active = item.id === instrument?.id;
    const solution = getSolution(segment, item);
    return `
      <div class="rail-item ${available ? 'available' : 'locked'} ${active ? 'active' : ''}"
        style="--item-color:${escapeHtml(item.color)}">
        ${iconMarkup(item.icon)}
        <strong>${escapeHtml(item.label)}</strong>
        <span class="rail-state">${active ? '✓' : available ? '' : '×'}</span>
        ${active && solution?.solution ? `<small>${escapeHtml(solution.solution)}</small>` : ''}
      </div>
    `;
  }).join('');

  if (!segment) {
    els.railHint.textContent = 'Selecciona un segmento desde la tablet para comenzar.';
  } else if (state.phase === 'problem') {
    els.railHint.textContent = 'La barrera permanece visible hasta que la persona confirme su lectura.';
  } else if (state.phase === 'solutions' && state.selectionMode === 'compare') {
    els.railHint.textContent = 'El segmento y su conexión permanecen activos mientras se compara otra solución.';
  } else if (state.phase === 'solutions') {
    els.railHint.textContent = 'Solo se muestran los instrumentos válidos para este segmento.';
  } else {
    els.railHint.textContent = instrument
      ? `Explorando ${instrument.label}. Las entidades participantes se iluminan en la TV.`
      : 'Selecciona una solución desde la tablet.';
  }
}

function cancelSequence() {
  sequenceToken += 1;
  sequenceTimers.forEach(timer => clearTimeout(timer));
  sequenceTimers = [];
  sequenceFrames.forEach(frame => cancelAnimationFrame(frame));
  sequenceFrames = [];
  sequenceAnimations.forEach(animation => animation.cancel());
  sequenceAnimations = [];
  els.particles.forEach(particle => {
    particle.classList.remove('visible');
    particle.setAttribute('cx', '-30');
    particle.setAttribute('cy', '-30');
  });
  els.routeMarker.hidden = true;
  els.routeMarker.classList.remove('showing');
}

function later(callback, delay, token) {
  const timer = setTimeout(() => {
    if (token === sequenceToken) callback();
  }, delay);
  sequenceTimers.push(timer);
}

function resetVisualStates() {
  document.querySelectorAll('.segment-node, .actor-node').forEach(node => {
    node.classList.remove('active', 'available', 'disabled', 'dim', 'arrival');
    node.dataset.state = 'idle';
    const role = node.querySelector('.actor-role');
    if (role) {
      role.hidden = true;
      role.textContent = '';
    }
  });
  document.querySelectorAll('.instrument-ring').forEach(ring => {
    ring.classList.remove('available', 'selected', 'disabled');
  });
  document.querySelectorAll('.route').forEach(path => {
    path.classList.remove('active', 'complete');
    path.style.removeProperty('--route-color');
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
  });
  els.annotation.hidden = true;
  els.annotation.innerHTML = '';
  els.bid.classList.remove('pulse');
}

function routeElement(kind, id) {
  return document.querySelector(`#${kind}Route-${CSS.escape(id)}`);
}

function completePath(path, color) {
  if (!path) return;
  const length = path.getTotalLength();
  path.style.setProperty('--route-color', color);
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = '0';
  path.classList.add('complete');
}

function animateParticle(path, duration, color, token, particleIndex = 0) {
  const particle = els.particles[particleIndex];
  if (!particle) return;
  const length = path.getTotalLength();
  const startedAt = performance.now();
  particle.style.setProperty('--route-color', color);
  particle.classList.add('visible');

  function frame(now) {
    if (token !== sequenceToken) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    const point = path.getPointAtLength(length * eased);
    particle.setAttribute('cx', point.x.toFixed(2));
    particle.setAttribute('cy', point.y.toFixed(2));

    if (progress < 1) {
      const frameId = requestAnimationFrame(frame);
      sequenceFrames.push(frameId);
    } else {
      particle.classList.remove('visible');
    }
  }

  const frameId = requestAnimationFrame(frame);
  sequenceFrames.push(frameId);
}

function animatePath(path, duration, color, token, particleIndex = 0) {
  if (!path) return;
  const length = path.getTotalLength();
  path.style.setProperty('--route-color', color);
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;
  path.classList.add('active');

  const animation = path.animate(
    [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
    {
      duration,
      easing: 'cubic-bezier(.2,.72,.2,1)',
      fill: 'forwards'
    }
  );
  sequenceAnimations.push(animation);
  animateParticle(path, duration, color, token, particleIndex);
}

function pulseBid() {
  els.bid.classList.remove('pulse');
  void els.bid.offsetWidth;
  els.bid.classList.add('pulse');
}

function focusSegment(segment) {
  document.querySelectorAll('.segment-node').forEach(node => {
    const active = node.dataset.id === segment.id;
    node.classList.toggle('active', active);
    node.classList.toggle('dim', !active);
    node.dataset.state = active ? 'active' : 'idle';
  });
  document.querySelectorAll('.actor-node').forEach(node => node.classList.add('dim'));
}

function setAvailableRings(segment) {
  document.querySelectorAll('.instrument-ring').forEach(ring => {
    const available = segment.allowedInstruments.includes(ring.dataset.id);
    ring.classList.toggle('available', available);
    ring.classList.toggle('disabled', !available);
  });
}

function focusRing(instrument) {
  document.querySelectorAll('.instrument-ring').forEach(ring => {
    ring.classList.toggle('selected', ring.dataset.id === instrument.id);
    ring.classList.toggle('disabled', ring.dataset.id !== instrument.id);
  });
}

function setActorVisualState(node, visualState, arrival = false, solution = null) {
  const nextState = actorVisualStates.has(visualState) ? visualState : 'idle';
  node.classList.toggle('active', nextState === 'active');
  node.classList.toggle('available', nextState === 'available');
  node.classList.toggle('disabled', nextState === 'disabled');
  node.classList.toggle('dim', nextState === 'idle' || nextState === 'disabled');
  node.classList.toggle('arrival', nextState === 'active' && arrival);
  node.dataset.state = nextState;
  const role = node.querySelector('.actor-role');
  if (!role) return;
  const roleCopy = solution?.actorLabels?.[node.dataset.id];
  role.textContent = roleCopy || '';
  role.hidden = nextState !== 'active' || !roleCopy;
}

function focusActors(actorIds, arrival = false, solution = null) {
  document.querySelectorAll('.actor-node').forEach(node => {
    setActorVisualState(node, actorIds.includes(node.dataset.id) ? 'active' : 'idle', arrival, solution);
  });
}

function revealActors(actorIds, solution, token) {
  focusActors([], false, solution);
  actorIds.forEach((actorId, index) => {
    later(() => {
      const node = document.querySelector(`.actor-node[data-id="${CSS.escape(actorId)}"]`);
      if (node) setActorVisualState(node, 'active', true, solution);
    }, index * (solution.branchDelayMs || 260), token);
  });
}

function illuminateParticipation(actorIds, solution, token, showActorLabels = false) {
  const roleCopy = showActorLabels ? solution : null;
  const delay = solution?.branchDelayMs || 260;
  focusActors([], false, roleCopy);
  actorIds.forEach((actorId, index) => {
    later(() => {
      const node = document.querySelector(`.actor-node[data-id="${CSS.escape(actorId)}"]`);
      if (node) setActorVisualState(node, 'active', true, roleCopy);
    }, index * delay, token);
  });
  const pulseDelay = Math.max(520, (actorIds.length - 1) * delay + 420);
  later(pulseBid, pulseDelay, token);
}

function showBarrier(segment) {
  const chips = segment.barrier.components || [];
  els.annotation.dataset.kind = 'barrier';
  els.annotation.style.setProperty('--annotation-color', '#4f9dff');
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup('triangle-alert')}
      <strong>Barrera principal</strong>
    </div>
    <div class="annotation-body">
      <p>${escapeHtml(segment.barrier.description)}</p>
    </div>
    ${chips.length ? `
      <div class="barrier-chips">
        ${chips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}
      </div>
    ` : ''}
  `;
  els.annotation.hidden = false;
}

function showSolution(instrument, solution) {
  els.annotation.dataset.kind = 'solution';
  els.annotation.style.setProperty('--annotation-color', instrument.color);
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup(instrument.icon)}
      <strong>Solución propuesta</strong>
    </div>
    <div class="annotation-body">
      <h2>${escapeHtml(instrument.label)}</h2>
      <p><strong>${escapeHtml(solution.solution)}</strong></p>
    </div>
    ${solution.plainMeaning ? `<div class="plain-meaning">${escapeHtml(solution.plainMeaning)}</div>` : ''}
  `;
  els.annotation.hidden = false;
}

function showRoute(segment, instrument, solution, includeResult) {
  const results = Array.isArray(solution.displayResults)
    ? solution.displayResults
    : Array.isArray(solution.results) ? solution.results : [];
  const actorNames = solution.targetActorIds
    .map(id => findProvider(id)?.short)
    .filter(Boolean);
  const participation = solution.privateParticipationShort
    || solution.privateParticipation
    || actorNames.join(' + ');
  els.annotation.dataset.kind = 'route';
  els.annotation.style.setProperty('--annotation-color', instrument.color);
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup(instrument.icon)}
      <strong>${includeResult ? 'Resultado' : 'Acción conjunta'}</strong>
    </div>
    <div class="annotation-body">
      <div class="dual-popup">
        <section class="dual-card dual-card-bd">
          <span>Solución propuesta de la BD</span>
          <strong>${escapeHtml(instrument.label)}</strong>
          <p>${escapeHtml(solution.solution)}</p>
        </section>
        <section class="dual-card dual-card-private">
          <span>Participación del sector privado</span>
          <strong>${escapeHtml(participation)}</strong>
        </section>
      </div>
      ${includeResult ? `
        <div class="result-chips">
          ${results.map(result => `<span>${escapeHtml(result)}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
  els.annotation.hidden = false;
}

function showPending(instrument, solution) {
  els.annotation.dataset.kind = 'pending';
  els.annotation.style.setProperty('--annotation-color', instrument.color);
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup(instrument.icon)}
      <strong>Por validar</strong>
    </div>
    <div class="annotation-body">
      <div class="dual-popup">
        <section class="dual-card dual-card-bd">
          <span>Solución propuesta de la BD</span>
          <strong>${escapeHtml(instrument.label)}</strong>
          <p>${escapeHtml(solution.solution)}</p>
        </section>
        <section class="dual-card dual-card-private">
          <span>Participación del sector privado</span>
          <strong>Por validar con cliente.</strong>
        </section>
      </div>
    </div>
  `;
  els.annotation.hidden = false;
}

function renderExperience() {
  cancelSequence();
  resetVisualStates();
  const token = sequenceToken;
  const phase = state.phase || 'idle';
  const [badge, baseTitle] = PHASE_COPY[phase] || PHASE_COPY.idle;
  const segment = findSegment();
  const instrument = findInstrument();
  const solution = getSolution(segment, instrument);
  const title = phase === 'solutions' && state.selectionMode === 'compare'
    ? 'Compara otra solución'
    : baseTitle;

  els.shell.dataset.instrument = instrument?.id || '';
  els.stepBadge.textContent = badge;
  els.stepTitle.textContent = title;
  renderRail(segment, instrument);

  if (!segment || phase === 'idle') return;

  focusSegment(segment);
  const segmentPath = routeElement('segment', segment.id);
  const segmentColor = '#4f9dff';

  if (phase === 'problem') {
    animatePath(segmentPath, data.animationTimings.segmentRouteMs, segmentColor, token);
    later(pulseBid, data.animationTimings.segmentRouteMs + 180, token);
    later(() => showBarrier(segment), data.animationTimings.barrierDelayMs, token);
    return;
  }

  completePath(segmentPath, segmentColor);

  if (phase === 'solutions') {
    setAvailableRings(segment);
    if (state.selectionMode !== 'compare') showBarrier(segment);
    return;
  }

  if (!instrument || !solution || !routePhases.has(phase)) return;

  focusRing(instrument);

  if (phase === 'instrument') {
    pulseBid();
    later(() => showSolution(instrument, solution), 180, token);
    return;
  }

  const validated = String(solution.mappingStatus || '').startsWith('validated');
  if (!validated || !solution.targetActorIds?.length) {
    showPending(instrument, solution);
    return;
  }

  if (phase === 'route') {
    showRoute(segment, instrument, solution, false);
    illuminateParticipation(solution.targetActorIds, solution, token, false);
    return;
  }

  if (phase === 'providers') {
    showRoute(segment, instrument, solution, false);
    illuminateParticipation(solution.targetActorIds, solution, token, false);
    return;
  }

  focusActors(solution.targetActorIds, false, null);
  pulseBid();
  showRoute(segment, instrument, solution, phase === 'result');
}

function fitDisplay() {
  const scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  const offsetX = (window.innerWidth - DESIGN_WIDTH * scale) / 2;
  const offsetY = (window.innerHeight - DESIGN_HEIGHT * scale) / 2;
  els.shell.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

const socket = createExperienceSocket(nextState => {
  state = nextState;
  renderExperience();
});

socket.onConnectionChange(online => {
  els.connection.classList.toggle('online', online);
  els.connection.lastChild.textContent = online ? ' Conectado' : ' Reconectando';
});

createDiagnosticsPanel({
  title: 'Diagnóstico TV',
  socket,
  getRows: () => [
    ['Fase', state.phase || 'idle'],
    ['Run ID', String(state.runId || 0)],
    ['Segmento', state.segmentId || 'ninguno'],
    ['Instrumento', state.instrumentId || 'ninguno']
  ]
});

window.addEventListener('resize', fitDisplay);
buildScene();
fitDisplay();
renderExperience();
