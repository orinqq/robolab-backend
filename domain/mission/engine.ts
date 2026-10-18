import type { GameMap } from "../game/map";
import { simulate } from "../game/simulator";
import type {
  Attempt,
  Command,
  ExecutionOutcome,
  ExecutionState,
  ExecutionTrace,
  Mission,
  Program,
  SolveResult,
} from "./contracts";
import {
  ContractError,
  MISSION_LIMITS,
  parseMission,
  parseProgram,
  positionKey,
  samePosition,
} from "./validation";

/** Vista del mapa para reutilizar los movimientos y colisiones del simulador existente. */
function movementMap(mission: Mission): GameMap {
  return {
    id: mission.id,
    rows: mission.grid.rows,
    cols: mission.grid.cols,
    start: mission.start,
    startHeading: mission.initialHeading,
    goal: null,
    stops: mission.checkpoints.map((c) => c.position),
    layout: [],
    walkable: new Set(
      mission.grid.cells
        .filter((c) => !c.obstacle)
        .map((c) => positionKey(c.position)),
    ),
  };
}
function initialState(mission: Mission): ExecutionState {
  return {
    position: mission.start,
    heading: mission.initialHeading,
    energyUsed: 0,
    visitedCheckpoints: [],
  };
}
function won(mission: Mission, state: ExecutionState): boolean {
  return (
    samePosition(state.position, mission.goal) &&
    state.visitedCheckpoints.length === mission.checkpoints.length
  );
}
type Transition =
  | { ok: true; state: ExecutionState; cost: number }
  | {
      ok: false;
      outcome: ExecutionOutcome;
      attemptedPosition: ExecutionState["position"];
    };
function transition(
  mission: Mission,
  map: GameMap,
  state: ExecutionState,
  command: Command,
): Transition {
  const run = simulate(
    { ...map, start: state.position, startHeading: state.heading },
    [command],
  );
  if (run.outcome.kind === "OFF_PATH") {
    const p = run.outcome.attempted;
    const outside =
      p.row < 0 || p.col < 0 || p.row >= map.rows || p.col >= map.cols;
    return {
      ok: false,
      outcome: outside ? "OUT_OF_BOUNDS" : "COLLISION",
      attemptedPosition: p,
    };
  }
  const next = run.steps[0]!.state;
  const moved = !samePosition(state.position, next.cell);
  const cost = moved
    ? mission.grid.cells.find((c) => samePosition(c.position, next.cell))!.cost
    : 0;
  if (state.energyUsed + cost > mission.energyBudget)
    return {
      ok: false,
      outcome: "ENERGY_EXCEEDED",
      attemptedPosition: next.cell,
    };
  const checkpoint = mission.checkpoints.find((c) =>
    samePosition(c.position, next.cell),
  );
  const visitedCheckpoints =
    checkpoint && !state.visitedCheckpoints.includes(checkpoint.id)
      ? [...state.visitedCheckpoints, checkpoint.id]
      : state.visitedCheckpoints;
  return {
    ok: true,
    cost,
    state: {
      position: next.cell,
      heading: next.heading,
      energyUsed: state.energyUsed + cost,
      visitedCheckpoints,
    },
  };
}

/** Entradas no confiables: valida antes de producir cualquier movimiento. */
export function executeMission(
  missionInput: unknown,
  programInput: unknown,
): ExecutionTrace {
  const mission = parseMission(missionInput);
  const program = parseProgram(programInput, mission.allowedCommands);
  return executeParsed(mission, program);
}
function executeParsed(mission: Mission, program: Program): ExecutionTrace {
  const map = movementMap(mission);
  const initial = initialState(mission);
  const steps: ExecutionTrace["steps"][number][] = [];
  let state = initial;
  const finish = (
    outcome: ExecutionOutcome,
    failedStep?: number,
    attemptedPosition?: ExecutionState["position"],
  ): ExecutionTrace => ({
    schemaVersion: 1,
    missionId: mission.id,
    missionRevision: mission.revision,
    initial,
    steps,
    final: state,
    energyUsed: state.energyUsed,
    visitedCheckpoints: state.visitedCheckpoints,
    outcome,
    ...(failedStep === undefined ? {} : { failedStep, attemptedPosition }),
  });
  for (const [i, command] of program.commands.entries()) {
    const next = transition(mission, map, state, command);
    if (!next.ok) return finish(next.outcome, i + 1, next.attemptedPosition);
    state = next.state;
    steps.push({ index: i + 1, command, cost: next.cost, state });
    if (won(mission, state)) return finish("SUCCESS");
  }
  return finish(
    samePosition(state.position, mission.goal)
      ? "MISSING_CHECKPOINTS"
      : "INCOMPLETE",
  );
}

type Candidate = { state: ExecutionState; commands: Command[] };
/** Min-heap: Dijkstra por energía, desempate por cantidad de comandos. */
class Frontier {
  private items: Candidate[] = [];
  private before(a: Candidate, b: Candidate): boolean {
    return (
      a.state.energyUsed < b.state.energyUsed ||
      (a.state.energyUsed === b.state.energyUsed &&
        a.commands.length < b.commands.length)
    );
  }
  push(item: Candidate): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!this.before(item, this.items[parent]!)) break;
      this.items[i] = this.items[parent]!;
      i = parent;
    }
    this.items[i] = item;
  }
  pop(): Candidate | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!this.items.length || !last) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (
        child + 1 < this.items.length &&
        this.before(this.items[child + 1]!, this.items[child]!)
      )
        child++;
      if (!this.before(this.items[child]!, last)) break;
      this.items[i] = this.items[child]!;
      i = child;
    }
    this.items[i] = last;
    return first;
  }
}
const stateKey = (mission: Mission, s: ExecutionState) => {
  const mask = mission.checkpoints.reduce(
    (bits, c, i) => bits | (s.visitedCheckpoints.includes(c.id) ? 1 << i : 0),
    0,
  );
  return `${positionKey(s.position)}@${s.heading}:${mask}`;
};

/** Dijkstra sobre posición, orientación y estaciones. Conserva etiquetas de costo/pasos
 * no dominadas: una ruta barata pero larga no puede eliminar otra que cabe en 128 pasos.
 * SEARCH_LIMIT nunca se confunde con una prueba de imposibilidad.
 */
export function solveMission(input: unknown, maxStates = 20000): SolveResult {
  const mission = parseMission(input);
  if (!Number.isSafeInteger(maxStates) || maxStates < 1 || maxStates > 100000)
    throw new RangeError("maxStates debe estar entre 1 y 100000.");
  const map = movementMap(mission);
  const frontier = new Frontier();
  frontier.push({ state: initialState(mission), commands: [] });
  const labels = new Map<string, { cost: number; steps: number }[]>();
  labels.set(stateKey(mission, initialState(mission)), [{ cost: 0, steps: 0 }]);
  let exploredStates = 0;
  let generatedStates = 1;
  let current: Candidate | undefined;
  while ((current = frontier.pop())) {
    const { state, commands } = current;
    if (exploredStates >= maxStates)
      return { status: "SEARCH_LIMIT", exploredStates };
    exploredStates++;
    if (won(mission, state))
      return {
        status: "SOLVED",
        program: { schemaVersion: 1, commands },
        cost: state.energyUsed,
        exploredStates,
      };
    if (commands.length === MISSION_LIMITS.commands) continue;
    for (const command of mission.allowedCommands) {
      const next = transition(mission, map, state, command);
      if (!next.ok) continue;
      const steps = commands.length + 1;
      const cost = next.state.energyUsed;
      const key = stateKey(mission, next.state);
      const previous = labels.get(key) ?? [];
      if (previous.some((p) => p.cost <= cost && p.steps <= steps)) continue;
      // También acota la memoria de la frontera, incluso en mapas adversarios.
      if (generatedStates >= maxStates)
        return { status: "SEARCH_LIMIT", exploredStates };
      generatedStates++;
      labels.set(key, [
        ...previous.filter((p) => !(cost <= p.cost && steps <= p.steps)),
        { cost, steps },
      ]);
      frontier.push({ state: next.state, commands: [...commands, command] });
    }
  }
  return { status: "UNSOLVABLE", exploredStates };
}

export function createAttempt(
  id: string,
  missionInput: unknown,
  programInput: unknown,
  startedAt: number,
  finishedAt: number,
): Attempt {
  if (
    !id.trim() ||
    id.length > 80 ||
    !Number.isSafeInteger(startedAt) ||
    !Number.isSafeInteger(finishedAt) ||
    startedAt < 0 ||
    finishedAt < startedAt
  ) {
    throw new ContractError([
      {
        code: "SCHEMA_INVALID",
        path: "attempt",
        message: "Identificador o tiempos no válidos.",
      },
    ]);
  }
  const mission = parseMission(missionInput);
  const program = parseProgram(programInput, mission.allowedCommands);
  return {
    schemaVersion: 1,
    id,
    missionId: mission.id,
    missionRevision: mission.revision,
    program,
    trace: executeParsed(mission, program),
    startedAt,
    finishedAt,
  };
}
