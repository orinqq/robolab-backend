import type { Mission, ValidationResult } from "../domain/mission/contracts";
import { solveMission } from "../domain/mission/engine";
import { missionFixtures } from "../domain/mission/fixtures";
import {
  ContractError,
  parseMission,
  validateMission,
} from "../domain/mission/validation";
import type { MissionRepository } from "./contracts";

/** Construcción inicial por plantillas revisadas. No es aún generación procedural. */
export function generate_map(grade: Mission["grade"]): Mission {
  const template = missionFixtures.find((m) => m.grade === grade);
  return parseMission(template);
}
export const solve_mission = solveMission;

/** Validez publicable: integridad + solución dentro de energía, paleta y 128 comandos. */
export function validate_mission(input: unknown): ValidationResult<Mission> {
  const structural = validateMission(input);
  if (!structural.ok) return structural;
  const solution = solveMission(structural.value);
  if (solution.status !== "SOLVED") {
    return {
      ok: false,
      issues: [
        {
          code: solution.status,
          path: "mission",
          message:
            solution.status === "SEARCH_LIMIT"
              ? "No se pudo certificar la misión dentro del límite de búsqueda."
              : "No existe una solución dentro de las reglas y el presupuesto.",
        },
      ],
    };
  }
  return structural;
}

/** Métricas observables; no equivalen a una validación de dificultad pedagógica. */
export function evaluate_difficulty(input: unknown) {
  const mission = parseMission(input);
  const solution = solveMission(mission);
  const traversable = mission.grid.cells.filter((c) => !c.obstacle);
  return {
    traversableCells: traversable.length,
    obstacleCount: mission.grid.cells.length - traversable.length,
    checkpointCount: mission.checkpoints.length,
    terrainCostRange: {
      min: Math.min(...traversable.map((c) => c.cost)),
      max: Math.max(...traversable.map((c) => c.cost)),
    },
    solutionStatus: solution.status,
    minimumEnergy: solution.status === "SOLVED" ? solution.cost : null,
    solutionCommands:
      solution.status === "SOLVED" ? solution.program.commands.length : null,
    energySlack:
      solution.status === "SOLVED"
        ? mission.energyBudget - solution.cost
        : null,
  };
}

/** Única puerta prevista para persistir propuestas. Revalida aun si el llamador dice “válida”. */
export async function save_mission<T = string>(
  input: unknown,
  repository: MissionRepository<T>,
): Promise<T> {
  const validation = validate_mission(input);
  if (!validation.ok) throw new ContractError(validation.issues);
  return repository.save(validation.value);
}
