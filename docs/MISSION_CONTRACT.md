# Contrato de misiones v1

Fuente ejecutable: `domain/mission/contracts.ts`; validadores en
`validation.ts`; tres ejemplos completos en `fixtures.ts` (segundo, tercero,
cuarto). Todos los contratos de nivel superior llevan `schemaVersion: 1` y
contienen solamente valores JSON, sin Set, Date, clases ni funciones.

## Esquemas

| Contrato | Campos y significado |
|---|---|
| Position | `{row, col}` enteros, índices desde cero |
| Cell | `position`, `terrain: plain o rough`, `obstacle: boolean`, `cost` entero 1–100 |
| Grid | `rows`, `cols` entre 1 y 12, `cells` con exactamente una entrada por coordenada |
| Checkpoint | `id` único y `position` |
| Mission | `schemaVersion`, `id`, `revision`, `title`, `objective`, `grade: 2,3,4`, `grid`, `start`, `goal`, `initialHeading`, `checkpoints`, `energyBudget`, `allowedCommands` |
| Program | `schemaVersion`, `commands`: lista plana no vacía de hasta 128 comandos |
| ExecutionState | `position`, `heading`, `energyUsed`, `visitedCheckpoints` |
| ExecutionTrace | `schemaVersion`, `missionId`, `missionRevision`, `initial`, `steps`, `final`, `energyUsed`, `visitedCheckpoints`, `outcome`; fallo: `failedStep`, `attemptedPosition` |
| ValidationResult<T> | `{ok:true,value:T,issues:[]}` o `{ok:false,issues:[{code,path,message}]}` |
| Attempt | `schemaVersion`, `id`, `missionId`, `missionRevision`, `program`, `trace`, `startedAt`, `finishedAt` |

`revision` es un entero positivo: cambia al editar el contenido de una misión;
`schemaVersion` cambia si cambia el formato o la semántica. Una versión desconocida
se rechaza, sin conversiones silenciosas. `id` y `checkpoint.id` tienen 1–80
caracteres, título hasta 200 y objetivo hasta 1000. Tiempos: enteros no negativos
en milisegundos Unix, fin igual o posterior al inicio. No hay nombre de estudiante.

## Coordenadas y comandos

La esquina superior izquierda es `{row:0,col:0}`; fila crece hacia abajo,
columna hacia la derecha. Orientación: 0 arriba, 90 derecha, 180 abajo y
270 izquierda. Cada misión declara su orientación inicial; fixtures: 90.

| Comando | Semántica | Letra física existente |
|---|---|---|
| FORWARD | Avanza una celda según orientación | A |
| BACKWARD | Retrocede una celda sin girar | R |
| TURN_LEFT | Gira 90° a la izquierda sin desplazamiento | D |
| TURN_RIGHT | Gira 90° a la derecha sin desplazamiento | Z |

No hay diagonales, saltos, código ejecutable ni comandos absolutos U/D/L/R.
La paleta es explícita, no vacía y sin duplicados. Un programa se valida entero
antes de ejecutar: comandos desconocidos, prohibidos o más de 128 se rechazan
con `ContractError` y cero movimientos, incluso si aparecen después de la meta.
El programa del editor sigue siendo un AST: `compile(blocks)` produce los
comandos de Program v1; `parseProgram` del módulo mission valida la lista plana.

## Energía, estaciones y finalización

- Se paga el costo de la celda al entrar, también en meta, estaciones,
  retrocesos y cada reingreso a una celda, incluso el inicio al regresar.
  Estar inicialmente en el inicio cuesta cero. Los giros cuestan cero.
- `terrain` es una etiqueta visual; el costo explícito determina la energía.
  Incluso los obstáculos tienen costo positivo para uniformidad del esquema,
  aunque nunca se ingresa en ellos. El presupuesto es entero 1–10000.
- Inicio, meta y estaciones deben ser distintos, estar dentro del mapa y no
  ser obstáculos. Máximo seis estaciones, con posiciones e ids únicos.
- Todas las estaciones son obligatorias, en cualquier orden. Se registran una
  sola vez al visitarlas; repetir visita no anula las anteriores.
- Victoria: llegar a meta con todas las estaciones y energía menor o igual al
  presupuesto. Se detiene en ese paso; los comandos restantes no se ejecutan.
  Cruzar la meta sin completar estaciones permite continuar.
- Colisión o salida del tablero detienen en el primer fallo. No se mueve ni
  cobra ese paso. Energía insuficiente también detiene antes de entrar o cobrar.
- Al agotar comandos: `MISSING_CHECKPOINTS` si termina en meta con estaciones
  pendientes; `INCOMPLETE` en otra posición. Otros resultados: `SUCCESS`,
  `COLLISION`, `OUT_OF_BOUNDS`, `ENERGY_EXCEEDED`.
- Índices de pasos de la traza desde 1. `steps` contiene solo pasos aceptados,
  incluidos giros. `failedStep` identifica el comando rechazado. No se asigna
  un resultado a un programa malformado: se devuelve error estructurado.

`validateMission` comprueba forma e integridad; **no prueba solvencia**.
`validate_mission` de generación añade `solveMission`. Solo una solución
certificada permite guardar. El solver minimiza energía sujeto a paleta,
checkpoints, presupuesto y longitud; desempata con menos comandos.
`UNSOLVABLE` significa que agotó la búsqueda sin solución bajo esos límites.
`SEARCH_LIMIT` bloquea el guardado sin declarar imposible el mapa.

En esta migración solo se incorpora el dominio; `validate_mission` y los puntos
de guardado de generación permanecen pendientes. Para el modo personalizado,
`domain/mission/custom.ts` añade `parseCustomMission`: exige filas y columnas
independientes entre 1 y 5 sin alterar el contrato v1 original (hasta 12).
Este parser valida integridad y política, no solvencia. Los futuros puntos de
entrada del servidor deben usarlo y certificar con el solver antes de persistir.
Todavía no existe aplicación de esta política mediante endpoints Convex.

## Serialización y confianza

Ejemplo de programa intercambiable:

```json
{"schemaVersion":1,"commands":["FORWARD","TURN_RIGHT","FORWARD"]}
```

Para una misión: `parseMission(JSON.parse(json))`. Para un programa:
`parseProgram(JSON.parse(json), mission.allowedCommands)`. Los parsers producen
objetos nuevos, descartan campos extra y rechazan versiones desconocidas.
Una propiedad nueva que cambie reglas requiere versión o migración explícita.

Las pruebas comprueban ida y vuelta JSON de misiones, programas, trazas e
intentos. Las trazas e intentos son salidas del motor, no evidencia aceptable del
cliente: al recibirlos el servidor debe regenerarlos desde la revisión guardada
y el programa validado. `createAttempt` recibe el reloj del servidor y calcula
la traza; no hay un parser que confíe en una traza enviada por el alumno.

La energía virtual no indica batería ni duración física. Convertir comandos
con `toRobotText(commands.map(move))` prueba compatibilidad de representación,
no autoriza movimiento real. Antes de enviarlos se requiere nueva validación
en servidor, acción explícita, límites temporales y una parada física operativa.
