// Métricas de uso en Firestore: un documento por día (id = fecha local AAAA-MM-DD)
// dentro de la colección COLLECTION. Solo la tablet escribe.
// Si no hay internet o Firebase falla, la experiencia sigue igual: los registros
// quedan en una cola local y se envían cuando vuelve la conexión.

const COLLECTION = 'Maqueta6_BID';
const FIREBASE_VERSION = '10.14.1';
const firebaseConfig = {
  apiKey: 'AIzaSyAd32fjHVssRxIzHijkeWd37MamHWzCajM',
  authDomain: 'f1-sap.firebaseapp.com',
  databaseURL: 'https://f1-sap-default-rtdb.firebaseio.com',
  projectId: 'f1-sap',
  storageBucket: 'f1-sap.appspot.com',
  messagingSenderId: '1043864334257',
  appId: '1:1043864334257:web:bcc854d01f1c12fa415790'
};

const QUEUE_KEY = 'maqueta6-metrics-queue';
const SESSION_KEY = 'maqueta6-metrics-session';
const RETRY_MS = 15000;

let firestorePromise = null;
let flushing = false;
let retryTimer = null;

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento local: se pierde solo la cola, no la experiencia.
  }
}

function localDate(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(ms) {
  return new Date(ms).toLocaleTimeString('es-CO', { hour12: false });
}

function seconds(fromMs, toMs) {
  return Math.round((toMs - fromMs) / 100) / 10;
}

function newId() {
  return crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
}

function getFirestore() {
  firestorePromise ||= (async () => {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [{ initializeApp }, fs] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-firestore.js`)
    ]);
    const app = initializeApp(firebaseConfig, 'maqueta6-metrics');
    return { db: fs.getFirestore(app), fs };
  })().catch(error => {
    firestorePromise = null;
    throw error;
  });
  return firestorePromise;
}

// Cada registro de la cola se traduce a un setDoc con merge sobre el documento del día.
function toFirestoreData(record, fs) {
  const base = {
    fecha: record.fecha,
    ultimaActualizacion: fs.serverTimestamp()
  };
  if (record.type === 'inicio') {
    return {
      ...base,
      ...(record.sesion.origen === 'bancaDesarrollo' ? { vecesBancaDesarrollo: fs.increment(1) } : {}),
      sesiones: { [record.sessionId]: record.sesion }
    };
  }
  return {
    ...base,
    ...(record.sesion.vioImpacto ? { sesionesCompletas: fs.increment(1) } : {}),
    sesiones: { [record.sessionId]: record.sesion }
  };
}

async function flush() {
  if (flushing) return;
  const queue = readJson(QUEUE_KEY, []);
  if (!queue.length) return;
  flushing = true;
  clearTimeout(retryTimer);
  try {
    const { db, fs } = await getFirestore();
    while (true) {
      const [record] = readJson(QUEUE_KEY, []);
      if (!record) break;
      await fs.setDoc(fs.doc(db, COLLECTION, record.fecha), toFirestoreData(record, fs), { merge: true });
      writeJson(QUEUE_KEY, readJson(QUEUE_KEY, []).filter(item => item.key !== record.key));
    }
  } catch (error) {
    console.warn('Métricas: no se pudieron enviar, se reintentará', error);
    retryTimer = setTimeout(flush, RETRY_MS);
  } finally {
    flushing = false;
  }
}

function enqueue(record) {
  writeJson(QUEUE_KEY, [...readJson(QUEUE_KEY, []), { ...record, key: newId() }]);
  flush();
}

function buildSummary(session, endMs, finalizadoPor) {
  const firstAt = name => session.pasos.find(step => step.paso === name)?.segundos ?? null;
  return {
    estado: 'finalizada',
    sala: session.sala,
    horaInicio: localTime(session.startedAt),
    horaFin: localTime(endMs),
    duracionTotalSeg: seconds(session.startedAt, endMs),
    hastaVerImpactoSeg: firstAt('verImpacto'),
    hastaInfoCompletaSeg: firstAt('verInfoCompleta'),
    sectores: session.pasos.filter(step => step.paso.startsWith('sector:')).map(step => step.paso.slice(7)),
    vioImpacto: firstAt('verImpacto') !== null,
    vioInfoCompleta: firstAt('verInfoCompleta') !== null,
    finalizadoPor,
    pasos: session.pasos
  };
}

export function createMetrics({ room = 'default' } = {}) {
  function current() {
    return readJson(SESSION_KEY, null);
  }

  function end(finalizadoPor, endMs = Date.now()) {
    const session = current();
    if (!session) return;
    writeJson(SESSION_KEY, null);
    enqueue({
      type: 'fin',
      fecha: session.fecha,
      sessionId: session.id,
      sesion: buildSummary(session, endMs, finalizadoPor)
    });
  }

  // Una sesión abierta al cargar la página quedó cortada (recarga o cierre de la tablet).
  const orphan = current();
  if (orphan) end('pagina recargada', orphan.lastAt || orphan.startedAt);
  flush();
  window.addEventListener('online', flush);

  return {
    // Botón "Banca de desarrollo" (o "Cambiar sector"): abre una sesión nueva.
    start(origen = 'bancaDesarrollo') {
      if (current()) end('nuevo inicio sin reiniciar');
      const now = Date.now();
      const session = { id: `${localTime(now).replace(/:/g, '')}-${newId().slice(0, 4)}`, fecha: localDate(now), sala: room, startedAt: now, lastAt: now, pasos: [] };
      writeJson(SESSION_KEY, session);
      enqueue({
        type: 'inicio',
        fecha: session.fecha,
        sessionId: session.id,
        sesion: { estado: 'en curso', origen, sala: room, horaInicio: localTime(now) }
      });
    },
    step(paso) {
      const session = current();
      if (!session) return;
      const now = Date.now();
      session.pasos.push({ paso, segundos: seconds(session.startedAt, now) });
      session.lastAt = now;
      writeJson(SESSION_KEY, session);
    },
    end
  };
}
