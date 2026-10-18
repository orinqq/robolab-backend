import type { Mission, Program, ValidationIssue } from "./contracts";
import { executeMission, solveMission } from "./engine";
import { parseMission, positionKey, samePosition } from "./validation";

export const MECHANICS = {
  ENERGY_OPTIMIZATION: { concepts: ["suma de costos", "presupuesto", "optimización"], rationale: "Comparar recorridos para respetar un presupuesto vinculante." },
  CHECKPOINT_DELIVERY: { concepts: ["planificación", "suma de costos", "estaciones obligatorias"], rationale: "El recorrido debe desviarse para completar todas las entregas." },
  ROUTE_COMPARISON: { concepts: ["comparación", "costos", "rutas alternativas"], rationale: "Comparar rutas simples de costos diferentes y descartar la que excede el presupuesto." },
} as const;
export type MissionFamily = keyof typeof MECHANICS;
// Adding a catalog entry requires an explicit deterministic validation policy.
const MECHANIC_RULES: Record<MissionFamily, { delivery: boolean; costTradeoff: boolean }> = {
  ENERGY_OPTIMIZATION: { delivery: false, costTradeoff: false },
  CHECKPOINT_DELIVERY: { delivery: true, costTradeoff: false },
  ROUTE_COMPARISON: { delivery: false, costTradeoff: true },
};
export const FUTURE_MECHANICS = ["RECHARGE", "SYMMETRY", "PATTERNS"] as const;
export function isMissionFamily(value: unknown): value is MissionFamily {
  return typeof value === "string" && Object.hasOwn(MECHANICS, value);
}
export type MechanicEvidence = {
  schemaVersion: 1;
  family: MissionFamily;
  minimumEnergy: number;
  budget: number;
  solution: Program;
  alternative?: { program: Program; cost: number; outcome: string };
  checkpointBypass?: { program: Program; cost: number; outcome: string };
};
export type MechanicValidation =
  | { ok: true; evidence: MechanicEvidence }
  | { ok: false; issues: ValidationIssue[] };
const failure = (message: string, code: ValidationIssue["code"] = "SCHEMA_INVALID"): MechanicValidation =>
  ({ ok: false, issues: [{ code, path: "mechanic", message }] });

function simpleRoute(m: Mission, program: Program): boolean {
  const trace = executeMission(m, program);
  const positions = [positionKey(m.start)];
  let previous = m.start;
  for (const step of trace.steps) {
    if (!samePosition(previous, step.state.position)) positions.push(positionKey(step.state.position));
    previous = step.state.position;
  }
  return new Set(positions).size === positions.length;
}

/** Conservative bounded witness search. Failure to find evidence does not prove absence. */
export function validateMechanic(input: unknown, family: MissionFamily): MechanicValidation {
  if (!isMissionFamily(family)) return failure("Familia no soportada; no se puede certificar.");
  const rules = MECHANIC_RULES[family];
  const m = parseMission(input);
  if (m.grid.rows > 5 || m.grid.cols > 5) return failure("Máximo 5 filas y 5 columnas para generación por mecánicas.");
  const solved = solveMission(m);
  if (solved.status !== "SOLVED") return failure("No se certificó una solución dentro del presupuesto.", solved.status);
  const evidence: MechanicEvidence = {
    schemaVersion: 1, family, minimumEnergy: solved.cost, budget: m.energyBudget, solution: solved.program,
  };
  if (rules.delivery) {
    if (!m.checkpoints.length) return failure("Las entregas requieren al menos una estación obligatoria.");
    const bypass = solveMission({ ...m, checkpoints: [] });
    if (bypass.status !== "SOLVED") return failure("No se certificó el recorrido sin entregas.", bypass.status);
    const trace = executeMission(m, bypass.program);
    if (trace.outcome !== "MISSING_CHECKPOINTS" || bypass.cost >= solved.cost)
      return failure("Las estaciones deben exigir un desvío con mayor costo que la ruta sin entregas.");
    evidence.checkpointBypass = { program: bypass.program, cost: bypass.cost, outcome: trace.outcome };
  }
  // Block each interior cell of the certified path, solve a counterfactual map,
  // then replay the witness on the ORIGINAL map. No claim rests on the altered map.
  const path = executeMission(m, solved.program).steps.map(s => s.state.position);
  const candidates = [...new Set(path.map(positionKey))].filter(key =>
    key !== positionKey(m.start) && key !== positionKey(m.goal) &&
    !m.checkpoints.some(c => positionKey(c.position) === key));
  let limited = false;
  for (const key of candidates) {
    const alternate = solveMission({ ...m, energyBudget: 10000, grid: {
      ...m.grid, cells: m.grid.cells.map(c => positionKey(c.position) === key ? { ...c, obstacle: true } : c),
    } });
    if (alternate.status === "SEARCH_LIMIT") limited = true;
    if (alternate.status !== "SOLVED") continue;
    const relaxed = { ...m, energyBudget: 10000 };
    const trace = executeMission(relaxed, alternate.program);
    if (trace.outcome !== "SUCCESS" || trace.energyUsed <= m.energyBudget) continue;
    if (!simpleRoute(relaxed, alternate.program) || !simpleRoute(m, solved.program)) continue;
    if (rules.costTradeoff) {
      // Same commands on uniform-cost cells must reverse or erase the preference:
      // proves costs on relevant paths matter, not decorative terrain elsewhere.
      const uniform = { ...relaxed, grid: { ...m.grid, cells: m.grid.cells.map(c => ({ ...c, cost: 1 })) } };
      const cheapSteps = executeMission(uniform, solved.program).energyUsed;
      const expensiveSteps = executeMission(uniform, alternate.program).energyUsed;
      if (expensiveSteps > cheapSteps) continue;
    }
    evidence.alternative = {
      program: alternate.program, cost: trace.energyUsed,
      outcome: executeMission(m, alternate.program).outcome,
    };
    break;
  }
  if (!evidence.alternative) return failure(
    "No se certificaron rutas simples alternativas de costo distinto con presupuesto vinculante" +
    (family === "ROUTE_COMPARISON" ? " y una preferencia determinada por los costos de celda." : "."),
    limited ? "SEARCH_LIMIT" : "SCHEMA_INVALID",
  );
  return { ok: true, evidence };
}
