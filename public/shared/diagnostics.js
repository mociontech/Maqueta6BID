export function createDiagnosticsPanel({ title = 'Diagnóstico', socket, getRows = () => [] }) {
  const panel = document.createElement('aside');
  panel.className = 'diagnostics-panel';
  panel.hidden = true;
  document.body.append(panel);

  const fps = { value: 0, frames: 0, last: performance.now() };

  function frame(now) {
    fps.frames += 1;
    if (now - fps.last >= 1000) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.last));
      fps.frames = 0;
      fps.last = now;
    }
    requestAnimationFrame(frame);
  }

  function fmtTime(value) {
    if (!value) return 'sin datos';
    return new Date(value).toLocaleTimeString('es-CO', { hour12: false });
  }

  function render() {
    const ws = socket?.getStatus?.() || {};
    const rows = [
      ['WebSocket', ws.online ? 'conectado' : 'desconectado'],
      ['Estado WS', ws.readyState || 'desconocido'],
      ['FPS', String(fps.value || 'calculando')],
      ['Reintentos', String(ws.reconnects || 0)],
      ['Último mensaje', fmtTime(ws.lastMessageAt)],
      ...getRows()
    ];

    panel.innerHTML = `
      <div class="diagnostics-head">
        <strong>${title}</strong>
        <button type="button" data-diagnostics-close aria-label="Cerrar diagnóstico">×</button>
      </div>
      <dl>${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl>
      <p>Atajo: Ctrl + Alt + D</p>
    `;
  }

  function toggle(force) {
    panel.hidden = typeof force === 'boolean' ? !force : !panel.hidden;
    render();
  }

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey && event.altKey && key === 'd') || (event.shiftKey && key === 'd')) {
      event.preventDefault();
      toggle();
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-diagnostics-close]')) toggle(false);
    if (event.target.closest('[data-debug-toggle]')) toggle();
  });

  requestAnimationFrame(frame);
  render();
  setInterval(render, 800);

  return { toggle, render };
}
