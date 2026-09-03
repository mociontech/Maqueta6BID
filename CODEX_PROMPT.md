# Prompt recomendado para Codex

> Nota de versión: la dirección vigente usa tres zonas y prioriza la ruta validada Instituciones financieras → Financiamiento → Banco comercial. README.md y data/experience.json son la referencia actual.

Trabaja sobre este proyecto **Maqueta 6 — Banca de Desarrollo**.

Primero lee `README.md`, `AGENTS.md`, `data/experience.json` y revisa las imágenes en `public/assets/references/`.

## Objetivo

Convertir el prototipo funcional actual en la experiencia final para una exhibición del BID, manteniendo dos interfaces sincronizadas:

1. `/controller/` — tablet de control.
2. `/display/` — TV horizontal de 60 pulgadas (1920×1080).

## Lógica que NO debes cambiar

El usuario selecciona en la tablet:

1. Un segmento:
   - Instituciones financieras
   - Sector privado (Desarrolladores)
   - Personas & MiPymes

2. Un instrumento permitido para ese segmento:
   - Financiamiento
   - Garantías
   - Seguros
   - Capitales

La TV ejecuta una secuencia visual automática:

1. Enfoca el segmento.
2. Aparecen popups con barreras.
3. Se destaca el instrumento elegido alrededor de Banca de Desarrollo.
4. Se anima un puente desde el segmento hacia Banca de Desarrollo.
5. Desde Banca de Desarrollo se animan conexiones hacia los actores/proveedores movilizados.
6. Aparece el resultado y el copy final.

No habilites Seguros para Instituciones financieras salvo que se cambie explícitamente en `data/experience.json`.

## Visual

Usa las referencias de la carpeta `public/assets/references` como dirección artística, no como layout rígido.

La TV debe parecer una maqueta digital premium, no un dashboard corporativo genérico:

- Fondo oscuro azul petróleo.
- Banca de Desarrollo como nodo circular central.
- Tres zonas a la izquierda y cuatro actores financieros a la derecha:
  - instituciones financieras: arquitectura institucional latinoamericana;
  - sector privado: proyecto residencial de escala;
  - personas & MiPymes: barrio de casas latinoamericanas;
  - banco comercial, fondos de pensiones, aseguradora y mercado de capitales como actores independientes.
- Cuatro aros alrededor del centro para Financiamiento, Garantías, Seguros y Capitales.
- Rutas luminosas con animación de flujo.
- Popups de barreras cortos, legibles a 2–3 metros.
- Panel derecho para explicar selección, proveedor y resultado.
- Evitar estética excesivamente futurista o “IA”; debe sentirse como visualización arquitectónica premium.

## Animaciones

Mejora el prototipo con una librería ligera como GSAP o Motion One si aporta valor.

Secuencia sugerida:
- Segmento: 0.8–1.2 s.
- Barreras: entrada secuencial 2.5–3.5 s.
- Instrumento: aro central 2 s.
- Puente: trazo luminoso progresivo 2.5–3.5 s.
- Proveedores: aparición secuencial 3–4 s.
- Resultado: mantener hasta nueva selección.

Implementa cancelación correcta cuando el usuario cambia de selección durante una animación.

## Tablet

Hazla más cercana al wireframe del proyecto:
- mensaje introductorio en la parte superior;
- tres botones grandes de zonas;
- al seleccionar segmento, mostrar una síntesis de barreras;
- después mostrar solo instrumentos válidos;
- botón para volver/cambiar sector;
- feedback claro de que la ruta se está ejecutando en la TV.

## Robustez para evento

- Reconexión WebSocket automática.
- Mantener último estado válido si la tablet se desconecta.
- Botón de reset.
- Auto-reset configurable tras 60 s de inactividad.
- Modo kiosk recomendado en README.
- No depender de internet.
- Incluir un panel de diagnóstico oculto con estado de WebSocket y FPS básico.

## Entrega

Antes de terminar:
- prueba `/controller/` y `/display/` en paralelo;
- verifica 1920×1080;
- corrige overflow y textos ilegibles;
- no cambies los contenidos fuente sin documentarlo;
- actualiza README con cualquier cambio;
- resume archivos modificados y pendientes de validación con cliente.
