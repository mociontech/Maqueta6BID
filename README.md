# Maqueta 6 - Banca de Desarrollo

Experiencia local para una exhibición del BID con dos interfaces sincronizadas:

- `/controller/`: tablet de control.
- `/display/`: TV horizontal de 60 pulgadas, diseñada en 1920 × 1080.

La experiencia funciona sin internet. Los renders 3D, iconos, datos y scripts se sirven desde el mismo computador o NUC.

## Flujo implementado

1. La tablet presenta tres zonas:
   - Instituciones financieras.
   - Desarrolladores de vivienda y proyectos de escala.
   - Personas & MiPymes.
2. Al seleccionar una zona, la TV la ilumina y dibuja la ruta hacia BID.
3. La barrera principal aparece como anotación y permanece visible.
4. La tablet avanza cuando la persona pulsa `Ya lo leí · Ver soluciones`.
5. La TV y la tablet muestran únicamente los instrumentos válidos.
6. Al seleccionar un instrumento, la TV destaca su aro y presenta la solución.
7. La solución permanece 5,5 segundos para permitir su lectura.
8. Después se limpia el popup y las entidades del lado derecho se iluminan según la participación privada definida en el Excel actualizado.
9. El resultado aparece en la franja superior, fuera del mapa y sin cubrir nombres ni conexiones.
10. `Comparar otra solución` conserva la zona y la ruta hacia BID; solo limpia y reemplaza el instrumento, los actores y el resultado.

Seguros permanece deshabilitado para Instituciones financieras.

## Participaciones configuradas

Esta iteración elimina las flechas desde las entidades del lado derecho hacia Banca de Desarrollo. Esas entidades ya no trazan rutas; solamente se iluminan cuando corresponden a la columna `Participación del Sector privado en conjunto con la BD`.

Relaciones activas en el Excel actualizado:

- Instituciones financieras + Financiamiento: Banco comercial.
- Instituciones financieras + Garantías: Aseguradora.
- Instituciones financieras + Capitales: Fondos de pensiones + Mercado de capitales.
- Desarrolladores + Financiamiento: Banco comercial.
- Desarrolladores + Seguros: Aseguradora.
- Desarrolladores + Capitales: Fondos de pensiones + Mercado de capitales.
- Personas & MiPymes + Financiamiento: Banco comercial.
- Personas & MiPymes + Garantías: Banco comercial, tomado del texto "operar junto a la banca comercial".
- Personas & MiPymes + Seguros: Aseguradora.
- Personas & MiPymes + Capitales: Fondos de pensiones + Mercado de capitales.

Desarrolladores + Garantías queda como `pending-client-validation-no-private-participation`, porque la captura no muestra una entidad privada explícita para esa solución.

Seguros no pertenece a `allowedInstruments` para Instituciones financieras y el servidor rechaza cualquier intento de activarlo.

## Instalación

Requiere Node.js 20 o posterior.

```bash
npm install
npm start
```

Abre:

- Tablet: `http://localhost:3000/controller/`
- TV: `http://localhost:3000/display/`

En dos dispositivos de la misma red local, usa la IP del NUC:

- `http://192.168.1.20:3000/controller/`
- `http://192.168.1.20:3000/display/`

## Configuración

- `PORT`: puerto HTTP/WebSocket. Valor por defecto: `3000`.
- `AUTO_RESET_MS`: inactividad antes del reinicio automático. Valor por defecto: `60000`.
- `AUTO_RESET_MS=0`: desactiva el reinicio automático.

## Publicar en Netlify

El proyecto incluye `netlify.toml`. En Netlify usa:

- Build command: `npm run build:netlify`
- Publish directory: `public`
- Node: `20`

El build copia `data/experience.json` a `public/data/experience.json` para que la maqueta cargue como sitio estático.

Nota importante: Netlify sirve bien el preview visual, pero no reemplaza el servidor local `Express + WebSocket` para operación real con tablet y TV en dispositivos separados. En Netlify se activa un modo preview con `BroadcastChannel/localStorage`, útil para probar controller/display en pestañas del mismo navegador. Para exhibición en sala, usa `npm start` en el NUC o una plataforma Node persistente.

PowerShell:

```powershell
$env:AUTO_RESET_MS = "90000"
npm start
```

## Operación en evento

- Inicia el servidor con `npm start` o `start.bat`.
- Abre la TV antes que la tablet.
- La TV conserva el último estado válido si la tablet se desconecta.
- El WebSocket reconecta automáticamente con espera incremental.
- El servidor cancela la secuencia anterior cuando llega una nueva selección.
- El botón Reset funciona sin recargar el navegador.

### Modo kiosk recomendado

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=http://localhost:3000/display/
```

Para la tablet, usa pantalla completa en `/controller/`. En producción conviene fijar la IP del NUC y desactivar suspensión, ahorro de energía y actualizaciones automáticas durante la exhibición.

## Diagnóstico oculto

Disponible en tablet y TV:

- `Ctrl + Alt + D` o `Shift + D`.
- En tablet, toca el estado de conexión.
- En TV, toca el estado de conexión.

El panel muestra WebSocket, FPS básico, fase, `runId`, segmento e instrumento.

## Arquitectura visual

- Los renders 3D independientes están en `public/assets/scenes/`.
- `scene-development-bank-house.png` representa la sede central de Banca de Desarrollo y se sirve localmente con transparencia real.
- La sede central se presenta sin tarjeta inferior: solo se muestra la imagen arquitectónica de Banca de Desarrollo y su rótulo. Los ejemplos regionales permanecen documentados en `data/experience.json > meta.developmentBankHouse` para una posible etapa posterior.
- Los iconos Lucide usados por la interfaz están incluidos en `public/assets/icons/`.
- Aros, etiquetas y popups son HTML/CSS.
- Barrera, solución y resultado se muestran centrados sobre la sede y antes del aro exterior, sin ocupar la cabecera.
- En el paso final, el popup combina dos bloques: `Solución propuesta de la BD` y `Participación del sector privado`, para que ambas lecturas se vean al mismo tiempo.
- La conexión de cada zona hacia Banca de Desarrollo es un `path` SVG independiente con estados apagado, activo y completado.
- Las entidades del lado derecho no dibujan rutas ni flechas hacia el centro; se iluminan según `targetActorIds`.
- Las partículas recorren únicamente la conexión de la zona seleccionada hacia Banca de Desarrollo.
- Los actores usan los estados reutilizables `disabled`, `idle`, `available` y `active`.
- La composición se escala proporcionalmente, pero su lienzo de diseño es 1920 × 1080.

La utilidad `scripts/remove-checkerboard.js` convierte los renders fuente en PNG con alfa real. Usa `sharp` como dependencia de desarrollo; no se ejecuta durante la exhibición.

## Máquina de estados

```text
idle
  ↓
problem
  ↓ confirmación de lectura
solutions
  ↓ selección en tablet
instrument
  ↓
route
  ↓
result
```

Los tiempos están centralizados en `data/experience.json > animationTimings` y en la secuencia del servidor. `solutionReadMs` controla la pausa de lectura de la solución; actualmente está configurado en `5500` ms. `actorRouteMs` se conserva como nombre interno, pero ahora controla el tiempo del paso de iluminación de entidades, no una ruta del lado derecho.

## Agregar los otros segmentos

Las relaciones se agregan en `data/experience.json`, dentro de `segments[].solutions[instrumentId]`. Cada solución debe definir al menos:

- `solution` y `description`;
- `targetActorIds` con IDs existentes en `providers`;
- `privateParticipation` o `privateParticipationShort` para el popup de TV;
- `results` y `resultTitle`;
- `mappingStatus` con prefijo `validated` únicamente después de aprobación del cliente.

La tablet lee automáticamente `allowedInstruments` y `targetActorIds`, por lo que no debe enviar actores manualmente.

## Fuente y decisiones de contenido

Fuente principal: `source/M6 - Rol de la banca de D en LAC 190826.xlsx`.

Cambios documentados:

- El Excel contiene cuatro segmentos; la interfaz actual usa tres por la indicación más reciente del cliente.
- `Empresas (Proyectos de escala)` se presenta junto con Desarrolladores de vivienda.
- No se habilitó Seguros para Instituciones financieras.
- La actualización de reunión del 2026-09-02 cambió el comportamiento del lado derecho: las entidades se iluminan, pero no trazan flechas ni rutas hacia Banca de Desarrollo.
- El copy de participación privada se transcribió desde la captura del Excel actualizado.
- La visualización corta el copy de TV mediante `privateParticipationShort` y `displayResults`; el contenido fuente completo permanece en `privateParticipation`, `results` y `routeExplanation`.
- Se incorporaron FINDETER (Colombia) y SHF (México) como ejemplos visibles de bancas de desarrollo de la región, según la referencia entregada por el cliente.

Pendiente de validación con cliente:

- participación privada para `Desarrolladores + Garantías`;
- consolidación definitiva de Proyectos de escala dentro de Desarrolladores;
- copy final de sala y tiempos definitivos de lectura.
