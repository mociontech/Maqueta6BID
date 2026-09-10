import { createExperienceSocket } from '/shared/ws.js';
import { createDiagnosticsPanel } from '/shared/diagnostics.js';

const response = await fetch('/data/experience.json');
if (!response.ok) throw new Error('No se pudo cargar data/experience.json');
const data = await response.json();

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const PHASE_COPY = {
  idle: ['INICIO', data.meta.title],
  problem: ['PASO 1', 'Barrera de acceso'],
  solutions: ['PASO 1', 'Barrera de acceso'],
  instrument: ['PASO 2', 'Banca de Desarrollo activada'],
  route: ['PASO 3', 'Sector privado habilitado'],
  providers: ['PASO 3', 'Sector privado habilitado'],
  result: ['PASO 4', 'Transformacion de vivienda']
};

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
  stage: document.querySelector('#stage'),
  stepBadge: document.querySelector('#stepBadge'),
  stepTitle: document.querySelector('#stepTitle'),
  stepSubtitle: document.querySelector('#stepSubtitle'),
  connection: document.querySelector('#connectionStatus'),
  informalPanel: document.querySelector('#informalPanel'),
  formalPanel: document.querySelector('#formalPanel'),
  informalTitle: document.querySelector('#informalTitle'),
  formalTitle: document.querySelector('#formalTitle'),
  problemLabel: document.querySelector('#problemLabel'),
  resultLabel: document.querySelector('#resultLabel'),
  informalVideo: document.querySelector('#informalVideo'),
  formalVideo: document.querySelector('#formalVideo'),
  informalPoster: document.querySelector('#informalPoster'),
  formalPoster: document.querySelector('#formalPoster'),
  problemBullets: document.querySelector('#problemBullets'),
  resultChips: document.querySelector('#resultChips'),
  sectors: document.querySelector('#sectorNodes'),
  rings: document.querySelector('#instrumentRings'),
  instrumentPlazas: document.querySelector('#instrumentPlazas'),
  bid: document.querySelector('#bidPuck'),
  developmentBankImage: document.querySelector('#developmentBankImage'),
  developmentBankTitle: document.querySelector('#developmentBankTitle'),
  bankExamples: document.querySelector('#bankExamples'),
  annotation: document.querySelector('#annotation'),
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

function findSector(id = state.segmentId) {
  return data.segments.find(segment => segment.id === id);
}

function findInstrument(id = state.instrumentId) {
  return data.instruments.find(instrument => instrument.id === id);
}

function findProvider(id) {
  return data.providers.find(provider => provider.id === id);
}

function mappedInstrumentId(sector) {
  return sector?.mappedInstrumentId || sector?.allowedInstruments?.[0] || null;
}

function solutionFor(sector, instrumentId = mappedInstrumentId(sector)) {
  const configured = sector?.solutions?.[instrumentId];
  if (!configured) return null;
  return typeof configured === 'string'
    ? {
        enabled: true,
        solution: configured,
        description: configured,
        targetActorIds: [],
        results: []
      }
    : configured;
}

function sectorColor(id) {
  return ({
    intermediaries: '#4f9dff',
    investors: '#d3bb62',
    insurers: '#f28a30'
  })[id] || '#53e0c7';
}

function setVideoSource(video, poster, src) {
  if (!video) return;
  if (poster) video.poster = poster;
  if (src) {
    video.src = src;
    video.closest('.video-card')?.classList.add('has-video');
  }
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
}

function playVideo(video) {
  if (!video || !video.src) return;
  video.play().catch(() => {});
}

function pauseVideo(video) {
  if (!video || video.paused) return;
  video.pause();
}

function buildScene() {
  const media = data.meta.media || {};
  const problem = data.meta.problem || {};
  const transformation = data.meta.transformation || {};
  const house = data.meta.developmentBankHouse || {};

  els.stepSubtitle.textContent = data.meta.subtitle || '';
  els.informalTitle.textContent = transformation.beforeTitle || 'Vivienda informal';
  els.formalTitle.textContent = transformation.afterTitle || 'Vivienda formal';
  els.problemLabel.textContent = problem.label || 'Falta de financiamiento';
  els.resultLabel.textContent = transformation.resultTitle || 'Transformacion habilitada';
  els.developmentBankTitle.textContent = house.title || 'BANCA DE DESARROLLO';
  const informalPoster = media.informalPoster || '/assets/scenes/scene-people-msmes.png';
  const formalPoster = media.formalPoster || '/assets/scenes/scene-developers.png';
  els.informalPoster.src = informalPoster;
  els.formalPoster.src = formalPoster;
  setVideoSource(els.informalVideo, informalPoster, media.informalVideo);
  setVideoSource(els.formalVideo, formalPoster, media.formalVideo);
  els.developmentBankImage.src = media.developmentBank || '/assets/scenes/scene-development-bank-house.png';

  els.problemBullets.innerHTML = (problem.bullets || [])
    .map(item => `<li>${escapeHtml(item)}</li>`)
    .join('');

  els.resultChips.innerHTML = ['Credito formal', 'Riesgo compartido', 'Capital movilizado', 'Mejor vivienda']
    .map(item => `<span>${escapeHtml(item)}</span>`)
    .join('');

  els.bankExamples.innerHTML = (house.examples || [])
    .map(example => `<span><strong>${escapeHtml(example.name)}</strong> ${escapeHtml(example.country)}</span>`)
    .join('');

  els.rings.innerHTML = data.instruments.map(instrument => `
    <div class="instrument-ring" data-id="${escapeHtml(instrument.id)}" style="--ring-color:${escapeHtml(instrument.color)}">
      <span class="ring-label">${escapeHtml(instrument.label)}</span>
    </div>
  `).join('');

  els.instrumentPlazas.innerHTML = data.instruments.map((instrument, index) => `
    <article class="instrument-plaza" data-id="${escapeHtml(instrument.id)}" style="--plaza-color:${escapeHtml(instrument.color)}">
      <span>${String.fromCharCode(65 + index)}. ${escapeHtml(instrument.label)}</span>
      <strong>${escapeHtml(instrument.short)}</strong>
    </article>
  `).join('');

  els.sectors.innerHTML = data.segments.map(sector => {
    const provider = findProvider(sector.id);
    const solution = solutionFor(sector);
    const color = sectorColor(sector.id);
    return `
      <article class="sector-node" data-id="${escapeHtml(sector.id)}" style="--node-color:${escapeHtml(color)}">
        <img src="${escapeHtml(provider?.asset || sector.asset)}" alt="" />
        <div class="sector-label">
          ${iconMarkup(provider?.icon || sector.icon)}
          <strong>${escapeHtml(sector.shortLabel)}</strong>
        </div>
        <p class="sector-products" hidden>${escapeHtml((solution?.products || []).join(' · '))}</p>
      </article>
    `;
  }).join('');
}

function cancelSequence() {
  sequenceToken += 1;
  sequenceTimers.forEach(timer => clearTimeout(timer));
  sequenceFrames.forEach(frame => cancelAnimationFrame(frame));
  sequenceAnimations.forEach(animation => animation.cancel());
  sequenceTimers = [];
  sequenceFrames = [];
  sequenceAnimations = [];
  els.particles.forEach(particle => {
    particle.classList.remove('visible');
    particle.setAttribute('cx', '-40');
    particle.setAttribute('cy', '-40');
  });
}

function later(callback, delay, token) {
  const timer = setTimeout(() => {
    if (token === sequenceToken) callback();
  }, delay);
  sequenceTimers.push(timer);
}

function resetVisualStates() {
  els.shell.dataset.phase = state.phase || 'idle';
  els.shell.dataset.sector = state.segmentId || '';
  els.shell.dataset.instrument = state.instrumentId || '';
  els.informalPanel.classList.remove('active', 'dim');
  els.formalPanel.classList.remove('active', 'dim');
  els.bid.classList.remove('pulse');
  document.querySelectorAll('.sector-node').forEach(node => {
    node.classList.remove('active', 'dim');
    const products = node.querySelector('.sector-products');
    if (products) products.hidden = true;
  });
  document.querySelectorAll('.instrument-ring').forEach(ring => {
    ring.classList.remove('available', 'selected');
  });
  document.querySelectorAll('.instrument-plaza').forEach(plaza => {
    plaza.classList.remove('available', 'selected');
  });
  document.querySelectorAll('.route').forEach(path => {
    path.classList.remove('active', 'complete');
    path.style.removeProperty('--route-color');
    path.style.strokeDasharray = '';
    path.style.strokeDashoffset = '';
  });
  els.annotation.hidden = true;
  els.annotation.innerHTML = '';
}

function routeById(id) {
  return document.querySelector(`#${CSS.escape(id)}`);
}

function routeForSector(sectorId) {
  return document.querySelector(`#route-bd-${CSS.escape(sectorId)}`);
}

function transformRouteForSector(sectorId) {
  return document.querySelector(`#route-transform-${CSS.escape(sectorId)}`);
}

function animateParticle(path, duration, color, token, particleIndex = 0) {
  const particle = els.particles[particleIndex];
  if (!particle || !path) return;
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
    { duration, easing: 'cubic-bezier(.2,.72,.2,1)', fill: 'forwards' }
  );
  sequenceAnimations.push(animation);
  animateParticle(path, duration, color, token, particleIndex);
}

function completePath(path, color) {
  if (!path) return;
  const length = path.getTotalLength();
  path.style.setProperty('--route-color', color);
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = '0';
  path.classList.add('complete');
}

function pulseBid() {
  els.bid.classList.remove('pulse');
  void els.bid.offsetWidth;
  els.bid.classList.add('pulse');
}

function focusProblemSide(active = true) {
  els.informalPanel.classList.toggle('active', active);
  els.formalPanel.classList.toggle('dim', active);
  document.querySelectorAll('.sector-node').forEach(node => node.classList.add('dim'));
}

function focusSector(sectorId, active = true) {
  document.querySelectorAll('.sector-node').forEach(node => {
    const isActive = node.dataset.id === sectorId;
    node.classList.toggle('active', isActive && active);
    node.classList.toggle('dim', !isActive || !active);
    const products = node.querySelector('.sector-products');
    if (products) products.hidden = true;
  });
}

function setRings(sector, selected = false) {
  const selectedId = mappedInstrumentId(sector);
  document.querySelectorAll('.instrument-ring').forEach(ring => {
    const isMapped = ring.dataset.id === selectedId;
    ring.classList.toggle('available', Boolean(sector?.allowedInstruments?.includes(ring.dataset.id)));
    ring.classList.toggle('selected', selected && isMapped);
  });
  document.querySelectorAll('.instrument-plaza').forEach(plaza => {
    const isMapped = plaza.dataset.id === selectedId;
    plaza.classList.toggle('available', Boolean(sector?.allowedInstruments?.includes(plaza.dataset.id)));
    plaza.classList.toggle('selected', selected && isMapped);
  });
}

function updateResults(solution) {
  const results = Array.isArray(solution?.displayResults) && solution.displayResults.length
    ? solution.displayResults
    : ['Credito formal', 'Riesgo compartido', 'Vivienda formal'];
  els.resultChips.innerHTML = results.map(item => `<span>${escapeHtml(item)}</span>`).join('');
  els.resultLabel.textContent = solution?.resultTitle || data.meta.transformation?.resultTitle || 'Transformacion habilitada';
}

function showBarrier(sector) {
  const problem = sector?.barrier || data.meta.problem || {};
  const chips = problem.components || data.meta.problem?.bullets || [];
  els.annotation.dataset.kind = 'barrier';
  els.annotation.style.setProperty('--annotation-color', '#f28a30');
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup('triangle-alert')}
      <strong>${escapeHtml(problem.title || 'Barrera principal')}</strong>
    </div>
    <p><strong>${escapeHtml(problem.short || data.meta.problem?.label || 'Falta de financiamiento')}.</strong> ${escapeHtml(problem.description || data.meta.problem?.description || '')}</p>
    <div class="product-list">
      ${chips.slice(0, 4).map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}
    </div>
  `;
  els.annotation.hidden = false;
}

function showActivation(sector, instrument, solution) {
  els.annotation.dataset.kind = 'activation';
  els.annotation.style.setProperty('--annotation-color', instrument?.color || '#4f9dff');
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup('landmark')}
      <strong>Banca de Desarrollo activada</strong>
    </div>
    <p>${escapeHtml(solution?.routeExplanation || 'La BD reduce el riesgo antes de conectar con el sector privado.')}</p>
  `;
  els.annotation.hidden = false;
}

function showJointAction(sector, instrument, solution, includeResult = false) {
  const products = solution?.products || [];
  const results = solution?.displayResults || solution?.results || [];
  els.annotation.dataset.kind = includeResult ? 'result' : 'route';
  els.annotation.style.setProperty('--annotation-color', instrument?.color || sectorColor(sector?.id));
  els.annotation.innerHTML = `
    <div class="annotation-grid">
      <section class="annotation-card">
        <span>Solucion de la BD</span>
        <strong>${escapeHtml(instrument?.label || 'Instrumento')}</strong>
        <p>${escapeHtml(solution?.solution || '')}</p>
      </section>
      <section class="annotation-card">
        <span>Sector privado</span>
        <strong>${escapeHtml(sector?.label || '')}</strong>
        <p>${escapeHtml(solution?.privateParticipationShort || solution?.privateParticipation || '')}</p>
      </section>
    </div>
    <div class="product-list">
      ${products.slice(0, 4).map(product => `<span>${escapeHtml(product)}</span>`).join('')}
    </div>
    ${includeResult ? `
      <div class="annotation-results">
        ${results.slice(0, 3).map(result => `<span>${escapeHtml(result)}</span>`).join('')}
      </div>
    ` : ''}
  `;
  els.annotation.hidden = false;
}

function renderExperience() {
  cancelSequence();
  resetVisualStates();

  const token = sequenceToken;
  const phase = state.phase || 'idle';
  const sector = findSector();
  const instrument = findInstrument(mappedInstrumentId(sector));
  const solution = solutionFor(sector, instrument?.id);
  const [badge, title] = PHASE_COPY[phase] || PHASE_COPY.idle;
  const color = sectorColor(sector?.id);

  els.shell.dataset.phase = phase;
  els.shell.dataset.sector = sector?.id || '';
  els.shell.dataset.instrument = instrument?.id || '';
  els.stepBadge.textContent = badge;
  els.stepTitle.textContent = title;
  els.stepSubtitle.textContent = sector
    ? `${data.meta.subtitle} · ${sector.shortLabel}`
    : data.meta.subtitle;

  if (!sector || phase === 'idle') {
    els.informalPanel.classList.remove('dim');
    els.formalPanel.classList.add('dim');
    document.querySelectorAll('.sector-node').forEach(node => node.classList.remove('active', 'dim'));
    playVideo(els.informalVideo);
    pauseVideo(els.formalVideo);
    return;
  }

  updateResults(solution);
  focusProblemSide(true);
  setRings(sector, phase !== 'problem' && phase !== 'solutions');
  playVideo(els.informalVideo);
  if (phase === 'route' || phase === 'providers' || phase === 'result') playVideo(els.formalVideo);
  else pauseVideo(els.formalVideo);

  const barrierRoute = routeById('route-barrier');
  const sectorRoute = routeForSector(sector.id);
  const transformationRoute = transformRouteForSector(sector.id);

  if (phase === 'problem' || phase === 'solutions') {
    animatePath(barrierRoute, data.animationTimings.segmentRouteMs, color, token, 0);
    later(() => showBarrier(sector), data.animationTimings.barrierDelayMs || 0, token);
    return;
  }

  completePath(barrierRoute, color);

  if (phase === 'instrument') {
    pulseBid();
    setRings(sector, true);
    later(() => showActivation(sector, instrument, solution), 160, token);
    return;
  }

  if (phase === 'route' || phase === 'providers') {
    setRings(sector, true);
    showJointAction(sector, instrument, solution, false);
    later(pulseBid, 120, token);
    later(() => {
      focusSector(sector.id, true);
      animatePath(sectorRoute, data.animationTimings.actorRouteMs * .55, color, token, 1);
    }, 260, token);
    later(() => {
      els.formalPanel.classList.add('active');
      els.formalPanel.classList.remove('dim');
      animatePath(transformationRoute, data.animationTimings.actorRouteMs * .55, '#5ee6aa', token, 2);
    }, Math.round(data.animationTimings.actorRouteMs * .48), token);
    return;
  }

  if (phase === 'result') {
    setRings(sector, true);
    completePath(sectorRoute, color);
    completePath(transformationRoute, '#5ee6aa');
    focusSector(sector.id, true);
    els.formalPanel.classList.add('active');
    els.formalPanel.classList.remove('dim');
    showJointAction(sector, instrument, solution, true);
    pulseBid();
  }
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
  title: 'Diagnostico TV',
  socket,
  getRows: () => [
    ['Fase', state.phase || 'idle'],
    ['Run ID', String(state.runId || 0)],
    ['Sector', state.segmentId || 'ninguno'],
    ['Instrumento', state.instrumentId || mappedInstrumentId(findSector()) || 'ninguno']
  ]
});

window.addEventListener('resize', fitDisplay);
buildScene();
fitDisplay();
renderExperience();
