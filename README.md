# Maqueta 6 - Banca de Desarrollo

Experiencia local para una exhibicion del BID con dos interfaces sincronizadas:

- `/controller/`: tablet de control.
- `/display/`: TV horizontal de 60 pulgadas, disenada en 1920 x 1080.

La experiencia funciona sin internet. Los renders 3D, iconos, datos y scripts se sirven desde el mismo computador o NUC.

## Flujo vigente

La narrativa cambio en la ultima reunion:

1. La TV parte desde una situacion de vivienda informal a la izquierda.
2. La barrera comun es la falta de financiamiento: la familia no puede ir directamente al sector privado.
3. La tablet muestra tres sectores privados:
   - Intermediarios.
   - Inversionistas.
   - Aseguradoras.
4. Al seleccionar un sector, la TV muestra la barrera durante unos segundos para lectura.
5. Luego se activa la Banca de Desarrollo como puente obligatorio.
6. La BD enciende el instrumento asociado al sector:
   - Intermediarios: Financiamiento.
   - Inversionistas: Capitales.
   - Aseguradoras: Seguros.
7. El sector privado seleccionado se ilumina.
8. La ruta termina mostrando la transformacion hacia vivienda formal a la derecha.

No hay seleccion manual de instrumentos en la tablet en esta version. Internamente se conserva `segmentId + instrumentId` para mantener compatibilidad con WebSocket, reset, auto-reset y Netlify preview.

## Tablet

La tablet sigue el wireframe nuevo:

- Inicio: mensaje introductorio y boton `COMENZAR`.
- Seleccion: tres botones grandes, uno por sector privado.
- Activada: confirma que la Banca de Desarrollo esta actuando y muestra progreso de la TV.
- Final: cierre de participacion con opciones para explorar otro sector o volver al inicio.

Al tocar un sector, la tablet envia primero `selectSegment` para mostrar la barrera y, despues de `5200` ms, envia `runRoute` con el instrumento mapeado en `data/experience.json`.

## TV

La composicion nueva usa:

- izquierda: panel de vivienda informal y problema;
- centro: Banca de Desarrollo como edificio/nodo central;
- aros: Financiamiento, Garantias, Seguros y Capitales;
- parte inferior central: sectores privados;
- derecha: vivienda formal como resultado;
- rutas luminosas: vivienda informal -> BD -> sector privado -> vivienda formal.

Los popups se mantienen sobre la zona central de lectura, sin ocupar la cabecera ni tapar los nombres principales. El popup final muestra al mismo tiempo:

- `Solucion de la BD`;
- `Sector privado`;
- productos o instrumentos activados;
- resultados cortos.

## Assets y videos

Los assets actuales de `public/assets/scenes/` se usan como placeholders visuales de video:

- `scene-people-msmes.png`: poster de vivienda informal.
- `scene-developers.png`: poster de vivienda formal.
- `scene-development-bank-house.png`: sede de Banca de Desarrollo.

Cuando el cliente entregue clips reales, se recomienda agregarlos a `public/assets/video/` y conectar las rutas en `data/experience.json > meta.media` sin cambiar la logica.

## Instalacion

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

## Configuracion

- `PORT`: puerto HTTP/WebSocket. Valor por defecto: `3000`.
- `AUTO_RESET_MS`: inactividad antes del reinicio automatico. Valor por defecto: `60000`.
- `AUTO_RESET_MS=0`: desactiva el reinicio automatico.

## Publicar en Netlify

El proyecto incluye `netlify.toml`. En Netlify usa:

- Build command: `npm run build:netlify`
- Publish directory: `public`
- Node: `20`

El build copia `data/experience.json` a `public/data/experience.json` para que la maqueta cargue como sitio estatico.

Nota importante: Netlify sirve el preview visual, pero no reemplaza el servidor local `Express + WebSocket` para operacion real con tablet y TV en dispositivos separados. En Netlify se activa un modo preview con `BroadcastChannel/localStorage`, util para probar controller/display en pestanas del mismo navegador. Para exhibicion en sala, usa `npm start` en el NUC o una plataforma Node persistente.

PowerShell:

```powershell
$env:AUTO_RESET_MS = "90000"
npm start
```

## Operacion en evento

- Inicia el servidor con `npm start` o `start.bat`.
- Abre la TV antes que la tablet.
- La TV conserva el ultimo estado valido si la tablet se desconecta.
- El WebSocket reconecta automaticamente con espera incremental.
- El servidor cancela la secuencia anterior cuando llega una nueva seleccion.
- El boton Reset funciona sin recargar el navegador.

### Modo kiosk recomendado

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=http://localhost:3000/display/
```

Para la tablet, usa pantalla completa en `/controller/`. En produccion conviene fijar la IP del NUC y desactivar suspension, ahorro de energia y actualizaciones automaticas durante la exhibicion.

## Diagnostico oculto

Disponible en tablet y TV:

- `Ctrl + Alt + D` o `Shift + D`.
- En tablet, toca el estado de conexion.
- En TV, toca el estado de conexion.

El panel muestra WebSocket, FPS basico, fase, `runId`, sector e instrumento.

## Maquina de estados

```text
idle
  -> problem
  -> instrument
  -> route
  -> result
```

`problem` se activa al tocar un sector. La tablet lanza `runRoute` automaticamente despues de la pausa de lectura. `solutionReadMs` controla cuanto tiempo permanece la explicacion de la BD antes de activar la ruta al sector privado; actualmente esta en `5200` ms.

## Fuente y decisiones de contenido

Fuente base: `source/M6 - Rol de la banca de D en LAC 190826.xlsx`.

Cambios documentados:

- El flujo anterior de tres zonas + seleccion manual de instrumentos fue reemplazado por una narrativa de acceso a vivienda.
- La tablet ahora selecciona sectores privados: Intermediarios, Inversionistas y Aseguradoras.
- La barrera comun es falta de financiamiento para familias en vivienda informal.
- Cada sector tiene un instrumento BD mapeado internamente en `mappedInstrumentId`.
- Se mantienen FINDETER (Colombia) y SHF (Mexico) como ejemplos de Bancas de Desarrollo de la region dentro de `data/experience.json`.

Pendiente de validacion con cliente:

- videos reales de vivienda informal y vivienda formal;
- copy final de productos por sector;
- si Intermediarios debe incluir tambien Garantias como aro activo secundario;
- duraciones definitivas de lectura en sala.
