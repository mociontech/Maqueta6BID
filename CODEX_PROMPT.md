# Prompt recomendado para Codex

> Nota vigente: el flujo cambio. La maqueta ya no usa seleccion de zona + instrumento en la tablet. Ahora la narrativa es vivienda informal -> Banca de Desarrollo -> sector privado -> vivienda formal, alineada con `Maqueta_6_Storytelling_e_Interaccion.docx.pdf`. README.md y `data/experience.json` son la referencia actual.

Trabaja sobre este proyecto **Maqueta 6 - Banca de Desarrollo**.

Primero lee `README.md`, `AGENTS.md`, `data/experience.json` y revisa las imagenes en `public/assets/references/`.

## Objetivo

Convertir la experiencia en una maqueta digital premium para una exhibicion del BID, manteniendo dos interfaces sincronizadas:

1. `/controller/` - tablet de control.
2. `/display/` - TV horizontal de 60 pulgadas (1920x1080).

## Logica vigente

La tablet muestra:

1. Inicio con boton `COMENZAR`.
2. Activacion de la Banca de Desarrollo en la TV.
3. Seleccion de uno de tres sectores privados:
   - Intermediarios.
   - Inversionistas.
   - Aseguradoras.
4. Pantalla de `Conexion activada`.
5. Pantalla final.

La TV ejecuta una secuencia automatica:

1. Muestra vivienda informal a la izquierda.
2. Presenta la barrera principal: falta de financiamiento.
3. Explica que la familia no puede ir directamente al sector privado.
4. Activa la Banca de Desarrollo como puente.
5. Enciende el aro/instrumento asociado al sector seleccionado.
6. Muestra al mismo tiempo la solucion BD y la participacion del sector privado.
7. Ilumina el sector privado seleccionado.
8. Muestra la transformacion hacia vivienda formal a la derecha.

Internamente se conserva `segmentId + instrumentId` por compatibilidad:

- Intermediarios -> `financing`.
- Inversionistas -> `capital`.
- Aseguradoras -> `insurance`.

No reintroduzcas una segunda seleccion manual de instrumentos en la tablet salvo que el cliente lo pida explicitamente.

## Visual

Usa las referencias de `public/assets/references` como direccion artistica, no como layout rigido.

La TV debe sentirse como maqueta arquitectonica premium:

- fondo oscuro azul petroleo;
- panel izquierdo de vivienda informal/problema;
- video local de vivienda informal (`public/assets/video/viviendasInformales.mp4`);
- Banca de Desarrollo como edificio/nodo central;
- cuatro aros alrededor del centro: Financiamiento, Garantias, Seguros y Capitales;
- sectores privados cerca del centro: Intermediarios, Inversionistas, Aseguradoras;
- panel derecho de vivienda formal/transformacion;
- video local de vivienda formal (`public/assets/video/videoFormal.mp4`);
- rutas luminosas con flujo, siempre pasando por BD;
- popups cortos, legibles a 2-3 metros y sin tapar nombres ni rutas importantes.

Evita estetica excesivamente futurista o generica de dashboard.

## Animaciones

Secuencia sugerida:

- Barrera: visible aprox. 5 segundos antes de la ruta.
- Activacion BD: 0.8-1.2 s.
- Aro/instrumento: 2 s de lectura.
- Sector privado: trazo luminoso progresivo 2.5-3.5 s.
- Transformacion: mantener hasta nueva seleccion.

Implementa cancelacion correcta cuando el usuario cambia de seleccion durante una animacion.

## Robustez para evento

- Reconexion WebSocket automatica.
- Mantener ultimo estado valido si la tablet se desconecta.
- Boton de reset.
- Auto-reset configurable tras 60 s de inactividad.
- Modo kiosk recomendado en README.
- No depender de internet.
- Panel de diagnostico oculto con estado de WebSocket y FPS basico.

## Entrega

Antes de terminar:

- prueba `/controller/` y `/display/` en paralelo;
- verifica 1920x1080;
- corrige overflow y textos ilegibles;
- no cambies contenidos fuente sin documentarlo;
- actualiza README con cualquier cambio;
- resume archivos modificados y pendientes de validacion con cliente.
