import { COMMANDS } from "../game/program";
import { MAX_SEQUENCE } from "../robot/protocol";
import type {
  Cell,
  Command,
  Mission,
  Position,
  Program,
  ValidationIssue,
  ValidationResult,
} from "./contracts";

export const MISSION_LIMITS = {
  dimension: 12,
  checkpoints: 6,
  cost: 100,
  energy: 10000,
  commands: MAX_SEQUENCE,
} as const;

export class ContractError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "ContractError";
  }
}
function fail(path: string, message: string): never {
  throw new ContractError([{ code: "SCHEMA_INVALID", path, message }]);
}
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "Se esperaba un objeto.");
  return value as Record<string, unknown>;
}
function integer(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(path, `Se esperaba un entero entre ${min} y ${max}.`);
  return value;
}
function text(value: unknown, path: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(path, `Se esperaba texto de 1 a ${max} caracteres.`);
  return value;
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    fail(path, `Se esperaba una lista de hasta ${max} elementos.`);
  return value;
}
function version(value: unknown): void {
  if (value !== 1)
    fail("schemaVersion", "Versión no compatible; se requiere 1.");
}
function command(value: unknown, path: string): Command {
  if (!COMMANDS.includes(value as Command)) fail(path, "Comando desconocido.");
  return value as Command;
}
export const positionKey = (p: Position): string => `${p.row},${p.col}`;
export const samePosition = (a: Position, b: Position): boolean =>
  positionKey(a) === positionKey(b);

/** Normaliza a un DTO nuevo: descarta campos extra y no retiene referencias de la entrada. */
export function parseMission(input: unknown): Mission {
  const m = record(input, "mission");
  version(m.schemaVersion);
  const grid = record(m.grid, "grid");
  const rows = integer(grid.rows, "grid.rows", 1, MISSION_LIMITS.dimension);
  const cols = integer(grid.cols, "grid.cols", 1, MISSION_LIMITS.dimension);
  const position = (value: unknown, path: string): Position => {
    const p = record(value, path);
    return {
      row: integer(p.row, `${path}.row`, 0, rows - 1),
      col: integer(p.col, `${path}.col`, 0, cols - 1),
    };
  };
  const cells = list(grid.cells, "grid.cells", rows * cols).map(
    (value, i): Cell => {
      const path = `grid.cells[${i}]`;
      const c = record(value, path);
      if (c.terrain !== "plain" && c.terrain !== "rough")
        fail(`${path}.terrain`, "Terreno desconocido.");
      if (typeof c.obstacle !== "boolean")
        fail(`${path}.obstacle`, "Se esperaba un booleano.");
      return {
        position: position(c.position, `${path}.position`),
        terrain: c.terrain,
        obstacle: c.obstacle,
        cost: integer(c.cost, `${path}.cost`, 1, MISSION_LIMITS.cost),
      };
    },
  );
  if (
    cells.length !== rows * cols ||
    new Set(cells.map((c) => positionKey(c.position))).size !== cells.length
  )
    fail("grid.cells", "Debe existir exactamente una celda por coordenada.");
  const start = position(m.start, "start");
  const goal = position(m.goal, "goal");
  const checkpoints = list(
    m.checkpoints,
    "checkpoints",
    MISSION_LIMITS.checkpoints,
  ).map((value, i) => {
    const c = record(value, `checkpoints[${i}]`);
    return {
      id: text(c.id, `checkpoints[${i}].id`, 80),
      position: position(c.position, `checkpoints[${i}].position`),
    };
  });
  if (new Set(checkpoints.map((c) => c.id)).size !== checkpoints.length)
    fail("checkpoints", "Los identificadores deben ser únicos.");
  const occupied = [start, goal, ...checkpoints.map((c) => c.position)];
  if (new Set(occupied.map(positionKey)).size !== occupied.length)
    fail(
      "checkpoints",
      "Inicio, meta y estaciones deben ocupar casillas distintas.",
    );
  if (
    occupied.some(
      (p) => cells.find((c) => samePosition(c.position, p))?.obstacle,
    )
  )
    fail(
      "grid.cells",
      "Inicio, meta y estaciones deben estar libres de obstáculos.",
    );
  const allowedCommands = list(
    m.allowedCommands,
    "allowedCommands",
    COMMANDS.length,
  ).map((v, i) => command(v, `allowedCommands[${i}]`));
  if (
    !allowedCommands.length ||
    new Set(allowedCommands).size !== allowedCommands.length
  )
    fail("allowedCommands", "La paleta debe ser no vacía y sin repetidos.");
  if (![0, 90, 180, 270].includes(m.initialHeading as number))
    fail("initialHeading", "Orientación no válida.");
  if (m.grade !== 2 && m.grade !== 3 && m.grade !== 4)
    fail("grade", "Se requiere segundo, tercero o cuarto.");
  return {
    schemaVersion: 1,
    id: text(m.id, "id", 80),
    revision: integer(m.revision, "revision", 1, Number.MAX_SAFE_INTEGER),
    title: text(m.title, "title"),
    objective: text(m.objective, "objective", 1000),
    grade: m.grade,
    grid: { rows, cols, cells },
    start,
    goal,
    initialHeading: m.initialHeading as Mission["initialHeading"],
    checkpoints,
    energyBudget: integer(
      m.energyBudget,
      "energyBudget",
      1,
      MISSION_LIMITS.energy,
    ),
    allowedCommands,
  };
}
export function parseProgram(
  input: unknown,
  allowed: readonly Command[] = COMMANDS,
): Program {
  const p = record(input, "program");
  version(p.schemaVersion);
  const commands = list(p.commands, "commands", MISSION_LIMITS.commands).map(
    (v, i) => command(v, `commands[${i}]`),
  );
  if (!commands.length) fail("commands", "El programa está vacío.");
  if (commands.some((c) => !allowed.includes(c)))
    fail(
      "commands",
      "El programa usa comandos no permitidos para esta misión.",
    );
  return { schemaVersion: 1, commands };
}
export function validateMission(input: unknown): ValidationResult<Mission> {
  try {
    return { ok: true, value: parseMission(input), issues: [] };
  } catch (error) {
    if (error instanceof ContractError)
      return { ok: false, issues: error.issues };
    throw error;
  }
}
