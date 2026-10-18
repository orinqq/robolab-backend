# Generación matemática por mecánicas

## Alcance

Generador migrado desde el repositorio obsoleto `robolab` a `robolab-backend`,
rama `integracion/mission-v1`. Se reutilizan proveedor Groq, herramientas,
orquestador, prompts y pruebas originales. La conexión de acciones y persistencia
Convex al backend actualizado queda pendiente; no se copian esquemas antiguos. No modifica Mission v1,
frontend del estudiante, editor, plantillas del equipo ni firmware.

El objetivo se recibe como texto matemático del docente; el modelo interpreta su
relación con una familia explícita. No existe un clasificador determinista de
objetivos pedagógicos. Grado (2, 3 o 4) y dificultad guían el prompt, no acreditan
adecuación curricular ni dificultad pedagógica medida.

## Catálogo activo

`domain/mission/mechanics.ts` define el catálogo tipado y extensible.

| Familia | Evidencia exigida |
| --- | --- |
| ENERGY_OPTIMIZATION | Solver encuentra solución dentro del presupuesto; existe otra ruta simple que lo excede. |
| CHECKPOINT_DELIVERY | Lo anterior; al omitir todas las estaciones el solver encuentra una ruta más barata cuyo replay original termina MISSING_CHECKPOINTS. |
| ROUTE_COMPARISON | Dos rutas simples de costo distinto. La cara tiene igual o menos movimientos que la barata, pero supera el presupuesto. Al uniformar costos la preferencia se elimina o invierte. |

Todas las estaciones de Mission v1 son obligatorias. La comprobación de entregas
prueba relevancia colectiva de las estaciones; no prueba un desvío marginal
independiente por cada estación.

Recarga (`RECHARGE`), simetría (`SYMMETRY`) y patrones (`PATTERNS`) son futuras.
Se rechazan antes de llamar al proveedor. Recarga necesita nuevas transiciones y
solver; simetría y patrones necesitan reglas verificables, no solo narrativas.

## Solicitud

```json
{
  "objective": "Comparar sumas de costos y elegir una ruta con energía limitada.",
  "grades": [3],
  "family": "ROUTE_COMPARISON",
  "difficulty": "balanced",
  "constraints": {
    "rows": 3, "cols": 4,
    "plainCost": 1, "roughCost": 8, "minRough": 1,
    "checkpoints": 0, "minObstacles": 0, "maxEnergy": 12
  }
}
```

Filas/columnas son independientes entre 1 y 5. Las solicitudes con familia se
revalidan a máximo 5×5 aunque omitan dimensiones. Costos por terreno entre 1 y
100; `minRough` cuenta celdas transitables; estaciones son cantidad exacta y
obstáculos un mínimo. `maxEnergy` es un techo, no un presupuesto exacto.
No se alteran los límites del contrato Mission v1 ni las solicitudes históricas.

El prompt `mission-mechanics/3` añade instrucciones por familia antes de construir
el mapa. Las solicitudes sin familia siguen en `mission-activity/2`. El proveedor
Groq conserva el transporte y serializa la solicitud completa. No se agregan
quizzes, ventanas de operaciones ni desbloqueos por respuesta numérica.

## Validación y reparación

`validate_mission` y `solve_mission` se conservan. El orquestador añade comprobación
de restricciones y `validateMechanic`. Los errores específicos vuelven al LLM en
el mismo ciclo: una propuesta y máximo dos reparaciones por grado, 90 segundos
para la actividad y sin reintentos HTTP ocultos.

Para encontrar alternativas se bloquea, una por una, cada celda interior no
obligatoria del camino certificado y se invoca el solver con energía relajada.
Cada testigo se reproduce sobre el mapa ORIGINAL. Se excluyen vueltas mediante
la comprobación de posiciones no repetidas (los giros no agregan posiciones).
La ruta alternativa debe terminar SUCCESS al relajar solo energía y fallar por
ENERGY_EXCEEDED con el presupuesto original.

Cada búsqueda conserva el límite de 20 000 estados. A lo sumo se prueban 23
celdas candidatas en un tablero de 25 celdas. SEARCH_LIMIT no prueba imposibilidad.
El método es conservador: no enumera todos los caminos y puede rechazar mapas
con una mecánica válida cuyo testigo no encuentre. No mide aprendizaje, intuición,
interés, dificultad real ni todas las posibles decisiones del alumno.

Si fracasa la generación, se conserva el respaldo `template_fallback`, su objetivo
real y la advertencia existente; `fallbackSatisfiesConstraints` incluye ahora la
mecánica. No se etiqueta un respaldo incompatible como generación certificada.

## Metadatos separados y compatibilidad

Actualización IA 5: la persistencia y recertificación del sidecar ya están
implementadas mediante los endpoints `aiMissions` del backend actualizado. Ver
[AI_CONVEX_INTEGRATION.md](AI_CONVEX_INTEGRATION.md). Los párrafos siguientes
describen la etapa de migración previa; no son el estado de la integración IA 5.

`generation/pedagogy.ts` define un sidecar JSON con `schemaVersion: 1`,
identidad/revisión, familia, objetivo matemático, conceptos, justificación del
catálogo, restricciones solicitadas, evidencia reproducible y limitaciones.
La evidencia es calculada por el motor, nunca aceptada del LLM.

`generateActivity` mantiene EXACTAMENTE la forma de salida previa, compatible con
los validadores de Convex actuales. `generatePedagogicalActivity` es una envoltura
optativa `{ proposal, pedagogy }`. `savePedagogicalMission` revalida integridad,
solvencia, restricciones y mecánica antes de entregar ambos al repositorio
inyectado. Si cambia el id/revisión al persistir, el adaptador debe regenerar el
sidecar con la identidad definitiva.

No se añade una tabla ni se modifica el esquema Convex en esta entrega. El flujo
actual sigue guardando/publicando Mission v1 con su validación existente. El
sidecar todavía NO se persiste automáticamente ni se recertifica una familia al
editar/publicar usando las APIs históricas. Una integración posterior debe
almacenarlo por revisión y usar la puerta de validación pedagógica en cada
edición/publicación antes de anunciar certificación persistente de la familia.

## Verificación

Pruebas de las tres familias, replay de los testigos, estaciones, energía,
costos, solicitud malformada, familia no soportada, reparación acotada, fallback
y frontera de persistencia. Suite completa: `npm run verify`. Resultado en `robolab-backend`: typecheck y lint correctos;
39 archivos con 474 pruebas aprobadas y una evaluación real omitida por falta de
credencial local al momento de la verificación. El backend no define build;
su comprobación oficial es tipos, lint y pruebas. Hay 21 casos nuevos de mecánicas y
restricciones; se conservan las pruebas del backend actualizado. Las pruebas históricas de
guardado/publicación pasaron en la comprobación de compatibilidad del original;
no acreditan todavía endpoints de generación en el backend actualizado.

Evaluación Groq real: optativa, una familia, un grado y máximo tres llamadas.
La suite normal la omite; jamás usa una clave por accidente. Con la clave en el
archivo ignorado `.env.test.local`, ejecutar:

```bash
ROBOLAB_GROQ_EVAL=1 /usr/local/bin/node --env-file=.env.test.local node_modules/vitest/vitest.mjs run generation/groq.controlled.test.ts
```

Para otra familia, añadir `ROBOLAB_EVAL_FAMILY=CHECKPOINT_DELIVERY` o
`ENERGY_OPTIMIZATION`. No ejecutar las tres repetidamente por defecto. Los logs
contienen solo modelo, versión, llamadas, reparaciones, origen y costos de los
testigos. Un fallback hace fallar explícitamente la evaluación real.
