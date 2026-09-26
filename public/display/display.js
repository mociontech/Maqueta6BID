import { createExperienceSocket } from '/shared/ws.js';
import { createDiagnosticsPanel } from '/shared/diagnostics.js';

const response = await fetch('/data/experience.json');
if (!response.ok) throw new Error('No se pudo cargar data/experience.json');
const data = await response.json();

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const PHASE_COPY = {
  idle: ['INICIO', 'Cuando falta financiamiento, la vivienda informal crece'],
  bankIntro: ['INICIO', 'La banca de desarrollo cambia la ecuacion'],
  problem: ['PASO 1', 'Barrera de acceso'],
  solutions: ['PASO 1', 'Barrera de acceso'],
  instrument: ['PASO 2', 'Banca de Desarrollo activada'],
  route: ['PASO 3', 'Sector privado habilitado'],
  providers: ['PASO 3', 'Sector privado habilitado'],
  result: ['PASO 4', 'Transformacion de vivienda'],
  closing: ['CIERRE', 'Conectar para transformar']
};
const FIRST_BRIDGE_LOOP_START_SECONDS = 5;
const FIRST_BRIDGE_PLAYBACK_RATE = 1;
const PRIVATE_BRIDGE_VIDEO_MS = 10000;
const LEFT_BRIDGE_VIDEO_MS = 10000;
const LEFT_BRIDGE_SECTOR_ID = 'intermediaries';
const FIRST_BRIDGE_VISIBLE_PHASES = new Set(['problem', 'solutions', 'instrument', 'route', 'providers', 'result', 'closing']);

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
let playedVideoRun = {
  informal: null,
  formal: null
};
const revealedPrivateSectors = new Set();
let pendingRevealSectorId = null;

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
  idleInformalVideo: document.querySelector('#idleInformalVideo'),
  idleFormalVideo: document.querySelector('#idleFormalVideo'),
  finalFormalVideo: document.querySelector('#finalFormalVideo'),
  bridgeVideo1: document.querySelector('#bridgeVideo1'),
  bridgeVideo3: document.querySelector('#bridgeVideo3'),
  bridgeVideo4: document.querySelector('#bridgeVideo4'),
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
  video.loop = false;
  video.playbackRate = 1;
  video.playsInline = true;
  video.addEventListener('ended', () => {
    const card = video.closest('.video-card');
    if (video.dataset.keepVisibleOnEnd === 'true') {
      card?.classList.add('video-paused-visible');
    } else {
      card?.classList.add('video-ended');
    }
  });
}

function playVideo(video, options = {}) {
  if (!video || (!video.src && !video.currentSrc)) return;
  const card = video.closest('.video-card');
  card?.classList.remove('video-off', 'video-ended', 'video-paused-visible');
  video.closest('.final-formal-video')?.classList.remove('video-ready');
  video.loop = Boolean(options.loop);
  video.dataset.keepVisibleOnEnd = options.keepVisibleOnEnd ? 'true' : 'false';
  if (options.restart) {
    try { video.currentTime = 0; } catch {}
  }
  video.play().catch(() => {});
}

function resetVideoToPoster(video) {
  if (!video) return;
  video.pause();
  try { video.currentTime = 0; } catch {}
  video.load();
}

[els.idleInformalVideo, els.idleFormalVideo].forEach(video => {
  video?.addEventListener('ended', () => resetVideoToPoster(video));
});

function playVideoOnce(video, key, options = {}) {
  const runId = state.runId || 0;
  if (playedVideoRun[key] === runId) return;
  playedVideoRun[key] = runId;
  playVideo(video, { restart: true, ...options });
}

function stopVideo(video, reset = true, keepVisible = false) {
  if (!video) return;
  video.pause();
  video.loop = false;
  video.dataset.keepVisibleOnEnd = keepVisible ? 'true' : 'false';
  if (reset) {
    try { video.currentTime = 0; } catch {}
  }
  const card = video.closest('.video-card');
  card?.classList.toggle('video-off', !keepVisible);
  card?.classList.toggle('video-paused-visible', keepVisible);
  video.closest('.final-formal-video')?.classList.remove('video-ready');
}

els.finalFormalVideo?.addEventListener('playing', () => {
  els.finalFormalVideo.closest('.final-formal-video')?.classList.add('video-ready');
});

els.finalFormalVideo?.addEventListener('timeupdate', () => {
  if (els.finalFormalVideo.currentTime > 0.15) {
    els.finalFormalVideo.closest('.final-formal-video')?.classList.add('video-ready');
  }
});

function bridgeLoopStart(video) {
  const configuredStart = Number(video?.dataset.loopStart);
  const loopStart = Number.isFinite(configuredStart) ? configuredStart : FIRST_BRIDGE_LOOP_START_SECONDS;
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    return Math.min(loopStart, Math.max(0, video.duration - .2));
  }
  return loopStart;
}

function seekBridgeLoopStart(video) {
  if (!video) return;
  try { video.currentTime = bridgeLoopStart(video); } catch {}
}

function seekBridgeIntroStart(video) {
  if (!video) return;
  try { video.currentTime = 0; } catch {}
}

function playFirstBridgeVideo({ restart = false } = {}) {
  const video = els.bridgeVideo1;
  if (!video || (!video.src && !video.currentSrc)) return;
  video.muted = true;
  video.loop = false;
  video.playbackRate = FIRST_BRIDGE_PLAYBACK_RATE;
  video.playsInline = true;
  video.dataset.loopActive = 'true';
  video.closest('.bridge-video')?.classList.add('is-active');
  els.shell.dataset.firstBridgeVideo = 'active';

  const play = () => {
    if (restart || video.ended) seekBridgeIntroStart(video);
    video.play().catch(() => {});
  };

  if (video.readyState >= 1) play();
  else video.addEventListener('loadedmetadata', play, { once: true });
}

function playPrivateBridgeVideo({ restart = false } = {}) {
  const video = els.bridgeVideo3;
  if (!video || (!video.src && !video.currentSrc)) return;
  video.muted = true;
  video.loop = false;
  video.playbackRate = 1;
  video.playsInline = true;
  video.dataset.loopActive = 'true';
  video.closest('.bridge-video')?.classList.add('is-active');
  els.shell.dataset.privateBridgeVideo = 'active';

  const play = () => {
    if (restart || video.ended) seekBridgeIntroStart(video);
    video.play().catch(() => {});
  };

  if (video.readyState >= 1) play();
  else video.addEventListener('loadedmetadata', play, { once: true });
}

function playLeftBridgeVideo({ restart = false, loopOnly = false } = {}) {
  const video = els.bridgeVideo4;
  if (!video || (!video.src && !video.currentSrc)) return;
  video.muted = true;
  video.loop = false;
  video.playbackRate = 1;
  video.playsInline = true;
  video.dataset.loopActive = 'true';
  video.closest('.bridge-video')?.classList.add('is-active');
  els.shell.dataset.leftBridgeVideo = 'active';

  const play = () => {
    if (restart || video.ended) seekBridgeIntroStart(video);
    else if (loopOnly && video.currentTime < bridgeLoopStart(video)) seekBridgeLoopStart(video);
    video.play().catch(() => {});
  };

  if (video.readyState >= 1) play();
  else video.addEventListener('loadedmetadata', play, { once: true });
}

function stopFirstBridgeVideo(reset = true) {
  const video = els.bridgeVideo1;
  if (!video) return;
  video.dataset.loopActive = 'false';
  video.pause();
  if (reset) seekBridgeIntroStart(video);
  video.closest('.bridge-video')?.classList.remove('is-active');
  delete els.shell.dataset.firstBridgeVideo;
}

function stopPrivateBridgeVideo(reset = true) {
  const video = els.bridgeVideo3;
  if (!video) return;
  video.dataset.loopActive = 'false';
  video.pause();
  if (reset) seekBridgeIntroStart(video);
  video.closest('.bridge-video')?.classList.remove('is-active');
  delete els.shell.dataset.privateBridgeVideo;
}

function stopLeftBridgeVideo(reset = true) {
  const video = els.bridgeVideo4;
  if (!video) return;
  video.dataset.loopActive = 'false';
  video.pause();
  if (reset) seekBridgeIntroStart(video);
  video.closest('.bridge-video')?.classList.remove('is-active');
  delete els.shell.dataset.leftBridgeVideo;
}

function loopBridgeVideoFromConfiguredStart(video) {
  if (!video || video.dataset.loopActive !== 'true') return;
  seekBridgeLoopStart(video);
  video.play().catch(() => {});
}

[els.bridgeVideo1, els.bridgeVideo3, els.bridgeVideo4].forEach(video => {
  video?.addEventListener('ended', () => {
    loopBridgeVideoFromConfiguredStart(video);
  });

  video?.addEventListener('timeupdate', () => {
    if (video.dataset.loopActive !== 'true') return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    if (video.currentTime >= video.duration - .08) {
      loopBridgeVideoFromConfiguredStart(video);
    }
  });
});

function setSequenceSteps(...steps) {
  els.shell.dataset.sequence = steps.filter(Boolean).join(' ');
  updatePrivateRevealedState();
}

function updatePrivateRevealedState() {
  els.shell.dataset.privateRevealed = [...revealedPrivateSectors].join(' ');
}

function estimateVideoDurationMs(video, fallbackMs = 10000) {
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    return Math.round(video.duration * 1000);
  }
  return fallbackMs;
}

function revealBankIntroSequence(token) {
  const introVideo = els.idleInformalVideo || els.informalVideo;
  setSequenceSteps('maquette');
  stopVideo(els.informalVideo, true, false);
  stopVideo(els.formalVideo);
  stopVideo(els.idleInformalVideo, true, true);
  stopVideo(els.idleFormalVideo);

  later(() => setSequenceSteps('maquette', 'problem'), 3000, token);

  later(() => {
    setSequenceSteps('maquette', 'problem', 'video');
    playVideo(introVideo, { restart: true, loop: true, keepVisibleOnEnd: true });
    const videoMs = 10000;

    later(() => {
      setSequenceSteps('maquette', 'problem', 'video', 'bridge');
      playFirstBridgeVideo({ restart: true });
    }, videoMs, token);

    later(() => {
      setSequenceSteps('maquette', 'problem', 'video', 'bridge', 'bridge-text');
    }, videoMs + 2300, token);

    later(() => {
      setSequenceSteps('maquette', 'problem', 'video', 'bridge', 'bridge-text', 'bank-ring', 'main-copy');
      pulseBid();
    }, videoMs + 4300, token);

    later(() => {
      setSequenceSteps('maquette', 'problem', 'video', 'bridge', 'bridge-text', 'bank-ring', 'main-copy', 'center-copy');
    }, videoMs + 9300, token);
  }, 6500, token);
}

function privateStepForSector(sectorId) {
  const index = data.segments.findIndex(item => item.id === sectorId);
  return index >= 0 ? `private-${index + 1}` : null;
}

function currentPrivateSteps() {
  return data.segments
    .map(item => revealedPrivateSectors.has(item.id) ? privateStepForSector(item.id) : null)
    .filter(Boolean);
}

function allPrivateSteps() {
  return data.segments
    .map(item => privateStepForSector(item.id))
    .filter(Boolean);
}

function revealPrivateSectorRead(sector, token) {
  if (!sector?.id) {
    setSequenceSteps(...currentPrivateSteps());
    return;
  }

  const centerRoute = routeById('route-private-center');
  const sectorRoute = routeForSector(sector.id);

  // Si se cambio de sector antes de que terminara la animacion anterior,
  // no perder ese puente: completarlo de inmediato en vez de borrarlo.
  if (pendingRevealSectorId && pendingRevealSectorId !== sector.id && !revealedPrivateSectors.has(pendingRevealSectorId)) {
    completePath(routeForSector(pendingRevealSectorId), '#cfe1ff');
    revealedPrivateSectors.add(pendingRevealSectorId);
  }
  pendingRevealSectorId = null;

  const hadAnyReveal = revealedPrivateSectors.size > 0;
  const alreadyRevealed = revealedPrivateSectors.has(sector.id);

  // Mantener dibujados todos los puentes laterales ya revelados; nunca borrarlos.
  for (const revealedId of revealedPrivateSectors) {
    if (revealedId === LEFT_BRIDGE_SECTOR_ID) {
      playLeftBridgeVideo({ loopOnly: true });
    } else {
      completePath(routeForSector(revealedId), '#cfe1ff');
    }
  }

  if (alreadyRevealed) {
    setSequenceSteps('private-read', ...currentPrivateSteps());
    return;
  }

  const finishReveal = () => {
    revealedPrivateSectors.add(sector.id);
    pendingRevealSectorId = null;
    setSequenceSteps('private-read', ...currentPrivateSteps());
  };

  const revealLateralBridge = () => {
    pendingRevealSectorId = sector.id;
    setSequenceSteps(...currentPrivateSteps());
    if (sector.id === LEFT_BRIDGE_SECTOR_ID) {
      playLeftBridgeVideo({ restart: true });
      const leftBridgeMs = estimateVideoDurationMs(els.bridgeVideo4, LEFT_BRIDGE_VIDEO_MS);
      later(finishReveal, leftBridgeMs, token);
      return;
    }
    animatePath(sectorRoute, 4000, '#cfe1ff', token, 2);
    later(finishReveal, 4000, token);
  };

  if (!hadAnyReveal) {
    // El puente principal (central) solo se anima la primera vez; luego arrancan los puentes laterales.
    pendingRevealSectorId = sector.id;
    setSequenceSteps('private-bridge', ...currentPrivateSteps());
    playPrivateBridgeVideo({ restart: true });
    const privateBridgeMs = estimateVideoDurationMs(els.bridgeVideo3, PRIVATE_BRIDGE_VIDEO_MS);

    later(() => {
      centerRoute?.classList.remove('active', 'complete');
      centerRoute?.style.removeProperty('--route-color');
      if (centerRoute) {
        centerRoute.style.strokeDasharray = '';
        centerRoute.style.strokeDashoffset = '';
      }
      revealLateralBridge();
    }, privateBridgeMs, token);
    return;
  }

  revealLateralBridge();
}

function setFormalSequenceSteps(...steps) {
  setSequenceSteps(...steps);
}

function revealFormalTransformationSequence(token) {
  setFormalSequenceSteps('formal-bridge');
  stopVideo(els.formalVideo);
  stopVideo(els.finalFormalVideo);
  animatePath(routeById('route-formal-bridge'), 4000, '#cfe1ff', token, 0);

  later(() => {
    setFormalSequenceSteps('formal-bridge', 'formal-popup5');
  }, 4000, token);

  later(() => {
    setFormalSequenceSteps('formal-bridge', 'formal-popup5', 'formal-popup7');
  }, 5600, token);

  later(() => {
    setFormalSequenceSteps('formal-bridge', 'formal-popup5', 'formal-popup7', 'formal-video');
    playVideo(els.finalFormalVideo, { restart: true, loop: true, keepVisibleOnEnd: true });
  }, 7600, token);

  later(() => {
    setFormalSequenceSteps('formal-bridge', 'formal-popup5', 'formal-popup7', 'formal-video', 'formal-popup8');
  }, 17600, token);
}

function revealFullInfoSequence() {
  stopVideo(els.formalVideo);
  stopVideo(els.finalFormalVideo);

  for (const item of data.segments) {
    completePath(routeForSector(item.id), '#cfe1ff');
  }
  completePath(routeById('route-formal-bridge'), '#cfe1ff');

  setFormalSequenceSteps(
    'formal-bridge',
    'formal-popup5',
    'formal-video',
    'formal-popup8',
    ...allPrivateSteps()
  );
  playVideo(els.finalFormalVideo, { restart: true, loop: true, keepVisibleOnEnd: true });
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
  setVideoSource(els.finalFormalVideo, '/TV/aaaa%201.png', media.formalVideo);
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
  els.shell.dataset.mode = state.selectionMode || '';
  els.shell.dataset.sequence = '';
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
  stopVideo(els.finalFormalVideo);
  stopFirstBridgeVideo();
  stopPrivateBridgeVideo();
  stopLeftBridgeVideo();
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

function showAllRingsAvailable() {
  document.querySelectorAll('.instrument-ring, .instrument-plaza').forEach(item => {
    item.classList.add('available');
    item.classList.remove('selected');
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

function showInitialMessage() {
  const problem = data.meta.problem || {};
  els.annotation.dataset.kind = 'initial';
  els.annotation.style.setProperty('--annotation-color', '#f28a30');
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup('triangle-alert')}
      <strong>${escapeHtml(problem.headline || 'Cuando falta financiamiento, la vivienda informal crece.')}</strong>
    </div>
    <p>${escapeHtml(problem.description || 'El alto riesgo deja fuera a familias y proyectos de vivienda.')}</p>
  `;
  els.annotation.hidden = false;
}

function showBankIntro() {
  els.annotation.dataset.kind = 'bankIntro';
  els.annotation.style.setProperty('--annotation-color', '#4f9dff');
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup('landmark')}
      <strong>La banca de desarrollo cambia la ecuacion</strong>
    </div>
    <p>Aporta recursos, comparte riesgos y genera confianza para movilizar al sector privado.</p>
    <div class="annotation-results">
      <span>No actua sola</span>
      <span>Reduce riesgos</span>
      <span>Moviliza recursos</span>
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
        <strong>${escapeHtml(solution?.title || instrument?.label || 'Instrumento')}</strong>
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

function showClosing() {
  const transformation = data.meta.transformation || {};
  els.annotation.dataset.kind = 'closing';
  els.annotation.style.setProperty('--annotation-color', '#5ee6aa');
  els.annotation.innerHTML = `
    <div class="annotation-head">
      ${iconMarkup('circle-check')}
      <strong>${escapeHtml(transformation.closingTitle || 'Conectar para transformar')}</strong>
    </div>
    <p>${escapeHtml(transformation.closingCopy || 'La banca de desarrollo convierte barreras en oportunidades al compartir riesgos y movilizar inversion privada.')}</p>
    <div class="annotation-results">
      <span>Riesgo compartido</span>
      <span>Inversion movilizada</span>
      <span>Vivienda formal y digna</span>
    </div>
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
  els.shell.dataset.mode = state.selectionMode || '';
  els.stepBadge.textContent = badge;
  els.stepTitle.textContent = title;
  els.stepSubtitle.textContent = sector
    ? `${data.meta.subtitle} · ${sector.shortLabel}`
    : data.meta.subtitle;

  if (FIRST_BRIDGE_VISIBLE_PHASES.has(phase)) {
    playFirstBridgeVideo();
  }

  if (phase === 'idle') {
    revealedPrivateSectors.clear();
    updatePrivateRevealedState();
    pendingRevealSectorId = null;
    els.informalPanel.classList.remove('dim');
    els.formalPanel.classList.add('dim');
    document.querySelectorAll('.sector-node').forEach(node => node.classList.remove('active', 'dim'));
    playedVideoRun = { informal: null, formal: null };
    stopVideo(els.informalVideo, true, true);
    stopVideo(els.formalVideo);
    stopVideo(els.idleInformalVideo, true, true);
    stopVideo(els.idleFormalVideo);
    showInitialMessage();
    return;
  }

  if (phase === 'bankIntro') {
    revealedPrivateSectors.clear();
    updatePrivateRevealedState();
    pendingRevealSectorId = null;
    els.informalPanel.classList.add('active');
    els.formalPanel.classList.add('dim');
    document.querySelectorAll('.sector-node').forEach(node => node.classList.remove('active', 'dim'));
    showAllRingsAvailable();
    els.annotation.hidden = true;
    revealBankIntroSequence(token);
    return;
  }

  if (phase === 'closing') {
    els.informalPanel.classList.remove('dim');
    els.formalPanel.classList.remove('active', 'dim');
    showAllRingsAvailable();
    document.querySelectorAll('.sector-node').forEach(node => node.classList.add('active'));
    completePath(routeById('route-barrier'), '#4f9dff');
    for (const item of data.segments) {
      revealedPrivateSectors.add(item.id);
    }
    updatePrivateRevealedState();
    stopVideo(els.informalVideo, false, true);
    playVideo(els.idleInformalVideo, { loop: true, keepVisibleOnEnd: true });
    els.annotation.hidden = true;
    revealPrivateSectorRead(null);
    if (state.selectionMode === 'fullInfo') revealFullInfoSequence(token);
    else revealFormalTransformationSequence(token);
    pulseBid();
    return;
  }

  if (!sector) {
    return;
  }

  updateResults(solution);
  focusProblemSide(true);
  setRings(sector, phase !== 'problem' && phase !== 'solutions');
  if (phase === 'problem' || phase === 'solutions' || phase === 'instrument' || phase === 'route' || phase === 'providers') {
    playVideoOnce(els.informalVideo, 'informal', { loop: true });
  } else {
    stopVideo(els.informalVideo, false, true);
  }
  if (phase === 'closing') playVideoOnce(els.formalVideo, 'formal');
  else stopVideo(els.formalVideo);

  const barrierRoute = routeById('route-barrier');

  if (phase === 'problem' || phase === 'solutions') {
    playVideo(els.idleInformalVideo, { loop: true, keepVisibleOnEnd: true });
    revealPrivateSectorRead(sector, token);
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
    }, 260, token);
    return;
  }

  if (phase === 'result') {
    setRings(sector, true);
    focusSector(sector.id, true);
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
