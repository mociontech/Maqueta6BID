# Instrucciones para Codex — Maqueta 6

## Fuente de verdad
- `data/experience.json` contiene la lógica de contenido.
- `source/M6 - Rol de la banca de D en LAC 190826.xlsx` es la fuente entregada por el cliente.
- No inventar nuevas relaciones de contenido sin marcarlas explícitamente como propuesta o inferencia.

## Reglas de producto
- La tablet es el controlador; la TV no necesita ser táctil.
- Mantener sincronización local por WebSocket.
- La app debe funcionar sin internet durante el evento.
- La TV está pensada para 1920×1080 horizontal.
- Mantener las tres zonas vigentes y los cuatro instrumentos. Proyectos de escala se presenta junto con Desarrolladores hasta nueva validación del cliente.
- Seguros no debe habilitarse para Instituciones financieras mientras el cliente no lo valide.
- Países, cifras o entidades adicionales no deben añadirse sin fuente.

## Código
- Mantener HTML/CSS/JS simple y fácil de operar en un NUC.
- No introducir frameworks grandes sin una razón clara.
- Mantener los datos separados de la presentación.
- Probar controller y display en dos pestañas antes de cerrar una tarea.
