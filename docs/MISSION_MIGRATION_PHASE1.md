# Fase 1: seguridad Git y dominio Mission v1

Fecha: 18 de octubre de 2026. Rama de los tres repositorios: `integracion/mission-v1`.

## Seguridad

Antes de editar se comprobaron árboles limpios y `git fsck --full` de los tres
repositorios. Se crearon bundles `--all`, se verificaron con `git bundle verify`
y se restauraron en clones bare con `fsck` y comprobación del HEAD.
Ubicación local: `/Users/daya/workspaces/hack/git-backups/20261018-004222/`.
El archivo `manifest.json` conserva los HEAD, ramas previas y referencias.
Los bundles contienen historia y referencias Git, no secretos ni archivos ignorados.

Los commits originales `7575a74`, `f2829aa` y `2775fde` siguen siendo ancestros
del HEAD original y están incluidos en su respaldo. No se reescribió historia.
Se actualizaron las referencias remotas de los tres repositorios sin merge.
El backend coincide con `origin/main` en `86fbf8a`; la web tiene ocho commits
remotos nuevos de cámara/gestos que quedan fuera del alcance de esta fase.

## Migración

Se copiaron sin cambios desde `robolab/src/domain/mission/`: `contracts.ts`,
`validation.ts`, `engine.ts`, `fixtures.ts` y `mission.test.ts` al directorio
`domain/mission/` del backend. Se reutilizan los módulos existentes de movimiento,
programas y protocolo; no se modifica firmware ni se envían comandos físicos.

Se añade `custom.ts` como política pura de máximo 5 filas y 5 columnas,
independientes, conservando intacto el contrato Mission v1 original.
Las nuevas pruebas cubren solver y ejecución rectangular, costos de entrada,
giros gratuitos, energía insuficiente, checkpoints y rechazo de dimensiones.
La documentación del contrato se adapta a las rutas del backend.

## Verificación

`PATH=/usr/local/bin:$PATH npm run verify`, usando Node 22.14.0:
typecheck, lint y 35 archivos con 422 pruebas aprobados.
La prueba nueva se ejecutó primero y falló por ausencia del módulo de política;
después se añadió la implementación y pasó la verificación completa.

No se modificaron archivos existentes del motor de plantillas, Convex ni web.
El backend no define script de build: su verificación oficial es tipos/lint/tests.
No se ejecutan llamadas reales a Groq ni se acredita aún un flujo jugable integrado.

## Pendiente para revisión posterior

Groq, prompts, herramientas de generación, persistencia y autorización Convex,
discriminador, asignaciones, resultados, frontend y ejecución estudiantil.
Conectar `parseCustomMission` a los puntos de entrada del servidor y exigir
solvencia antes de guardar/publicar. No desplegar durante esta integración.
