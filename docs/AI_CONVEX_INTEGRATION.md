# IA 5 — Generación personalizada con Convex

Implementación en `ia/generacion-personalizada-convex`. La rama frontend
`ia/crear-con-ia-docente` está preparada sin cambios de código.

## Base y alcance

Al actualizar referencias, `origin/main` del backend estaba en `d4c4e17` y aún no
contenía la migración. Se incorporó la rama local `integracion/mission-v1` mediante
merge en la nueva rama, conservando ambos historiales. No se modificó `main`.
Se revisaron las instrucciones del backend y las guías Convex históricas, la
persistencia y acciones antiguas, y los servicios actuales de autenticación,
clases, asignaciones y resultados. Las instrucciones Convex no estaban instaladas
en el backend actual; se consultó la copia del repositorio original antes de editar.

Se reutilizan el orquestador, Groq, validadores Mission v1, solver y mecánicas.
No se sustituyen esquema, autorización, clases, asignaciones ni resultados.
Los nuevos endpoints son independientes de `labMissions` y `domain/lab`.
No se modifica frontend, editor, firmware ni se realizan llamadas pagadas.

## Endpoints para «Crear con IA (personalizado)»

Todos requieren la sesión docente existente. No aceptan `teacherId`, origen,
sidecar ni certificados como autoridad del navegador.

| Función | Uso |
| --- | --- |
| `api.aiGenerationActions.generate({request})` | Acción Node; valida solicitud y obtiene arrendamiento antes de llamar al proveedor; devuelve runId. |
| `api.aiGeneration.get({runId})` | Consulta privada de estado y propuestas, solo del propietario. |
| `api.aiMissions.createDraft({runId,grade})` | Guarda una propuesta completada propia; es idempotente por ejecución y grado. |
| `api.aiMissions.get({missionId})` | Identidad y última revisión, privadas. |
| `api.aiMissions.getRevision({missionId,revisionId})` | Revisión propia específica. |
| `api.aiMissions.listMine({paginationOpts})` | Identidades del docente, paginadas. |
| `api.aiMissions.listRevisions({missionId,paginationOpts})` | Historial de revisiones, paginado. |
| `api.aiMissions.updateDraft({missionId,revisionId,content,expectedEditVersion})` | Revalida y reemplaza contenido/sidecar del borrador. Devuelve nueva editVersion. |
| `api.aiMissions.publish({missionId,revisionId,expectedEditVersion})` | Revalida y publica administrativamente. No habilita ejecución estudiantil. |
| `api.aiMissions.createRevision({missionId,revisionId})` | Crea un nuevo borrador desde la última revisión publicada; conserva la anterior. |

Solicitud: mismo contrato descrito en `MISSION_MECHANICS.md`; aquí la familia es
obligatoria. Grados 2, 3 o 4; filas/columnas independientes 1–5; dificultad;
cantidad exacta de estaciones, obstáculos mínimos, costos plain/rough, mínimo de
terreno difícil transitable y techo de presupuesto energético. `maxEnergy` es un
máximo; el presupuesto concreto vive en el contenido Mission v1. No se inventa
un parámetro nuevo de presupuesto exacto ni se modifica el agente.

Las respuestas no contienen claves, cuerpo HTTP del proveedor, prompts, modelo
interno ni credenciales. Solo se conservan contenido, origen real, conteos y
advertencia segura. Los errores inesperados del action se normalizan y la
ejecución queda marcada como fallida.

## Tablas e índices añadidos

- `aiGenerationRuns`: propietario, solicitud normalizada, estado, propuestas,
  fechas y vencimiento. Índices `by_teacherId_and_status_and_leaseUntil` y
  `by_status_and_leaseUntil`.
- `aiMissions`: `schemaVersion:1`, `kind:ai_custom`, propietario, ejecución/grado,
  origen derivado de la ejecución, solicitud original, última revisión y fechas.
  Índices `by_teacherId` y
  `by_teacherId_and_generationRunId_and_generationGrade`.
- `aiMissionRevisions`: misión padre, número, estado, contenido Mission v1,
  sidecar tipado/versionado, editVersion y fechas. Índice `by_missionId_and_number`.

Son tablas nuevas; no requieren conversión de registros de plantillas ni backfill
sobre tablas existentes. Las consultas usan índices y paginación. Cada ejecución
guarda como máximo tres propuestas (una por grado), con tableros de hasta 25
celdas. Los validadores de almacenamiento describen misión, solicitud y sidecar.
Los campos `unknown` de entrada se parsean mediante reglas del dominio.

## Integridad y procedencia

`convex/lib/aiValidation.ts` aplica en servidor `parseCustomMission`,
`validate_mission` (incluye solver), restricciones originales y `buildPedagogy`
(incluye `validateMechanic`). No se aceptan sidecars del cliente.

La identidad definitiva se asigna antes de certificar la primera revisión.
Se mantienen `content.id === missionId`, `content.revision === number` y el
sidecar asociado a esos mismos valores. La creación, edición, copia de revisión
y publicación recalculan el sidecar; no reutilizan evidencia recibida ni obsoleta.
El grado de cada identidad no puede cambiar. Las restricciones originales se
conservan en la identidad de misión y no hay endpoint público para sustituirlas.

Una publicación es inmutable; para editar se crea otra revisión. `editVersion`
impide sobrescrituras entre ventanas y la transacción comprueba el último número
al crear revisiones. No se puede vincular una revisión a otra misión.

Un fallback conserva `origin:template_fallback`, se puede guardar como borrador
y lleva `verification:degraded_fallback`, sin evidencia certificada. No puede
publicarse si incumple la familia/restricciones. Puede corregirse y recertificarse
como revisión válida; su origen histórico sigue siendo fallback. La evidencia
del solver no acredita aprendizaje ni adecuación pedagógica.

## Autorización y límites

Se reutiliza `requireTeacher` de `convex/lib/access.ts`. La acción entra por
`internal.aiGeneration.begin`, que autentica antes de invocar Groq. Las guardas
privadas comprueban propietario y relación padre/revisión antes de leer o editar.
No hay endpoint público estudiantil ni lector anónimo, incluso tras publicar.
Las funciones internas begin/finish/fail no son invocables desde el navegador.

Los arrendamientos transaccionales conservan un máximo de una generación activa
por docente y dos globales, con vencimiento a 120 segundos. La actividad está
limitada a 90 segundos; máximo tres llamadas por grado (dos reparaciones),
como el agente existente. Los resultados vencidos no pueden finalizar.
Esto es control de concurrencia, no cuota diaria ni facturación. La renovación,
retención y cuotas por periodo quedan para una futura necesidad de operación.

## Publicación administrativa frente a jugabilidad

Toda identidad lleva `availability:not_available`, incluso publicada.
No existe mutación pública para cambiarlo. No se agrega al catálogo, asignaciones
ni respuestas de `student.home`; el laboratorio de plantillas no lo resuelve.
La futura integración del ejecutor y permisos estudiantiles deberá habilitar la
disponibilidad con otra versión/cambio explícito y sus pruebas.

## Desarrollo y verificación

En el deployment de DESARROLLO de Convex, configurar mediante su CLI:

```bash
npx convex env set GROQ_API_KEY
npx convex env set LLM_PROVIDER groq
npx convex env set LLM_MODEL openai/gpt-oss-20b
npx convex env set LLM_TIMEOUT_MS 15000
npx convex dev
```

El primer comando solicita el valor de forma interactiva; no llevarlo a git ni
al frontend. Las variables se leen con `deploymentEnv()`. Falta de clave o errores
del proveedor siguen la política de fallback, no crean falsas generaciones IA.

Se regeneraron los tipos con la CLI; `convex dev --once` comprobó esquema y
funciones en el backend LOCAL anónimo `127.0.0.1:3212`. No se usó producción.
Las pruebas usan `convex-test` y proveedores simulados; la evaluación real de Groq
permanece omitida por defecto. Ejecutar `npm run verify`,
`npx vitest run convex/aiMissions.test.ts`, y `git diff --check`.
Resultado final: typecheck y lint correctos, 519 pruebas aprobadas en 43
archivos, una evaluación real de Groq omitida, y 22 pruebas Convex específicas
aprobadas. `git diff --check` limpio. El backend no define build.

## Pendiente

La interfaz docente podrá consumir los endpoints anteriores cuando se integre
el paquete del backend con sus tipos generados. Esta iteración no implementa
pantallas, no actualiza dependencias del frontend y no habilita alumnos ni robot.
No hay despliegue a producción. La conexión estudiantil y asignación de contenido
personalizado continúan pendientes, conservando las funcionalidades del equipo.
