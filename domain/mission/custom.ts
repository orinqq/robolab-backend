import type { Mission } from "./contracts";
import { ContractError, parseMission } from "./validation";

/** Política del modo personalizado; no altera el contrato Mission v1 ni las plantillas. */
export const CUSTOM_MISSION_LIMITS = { rows: 5, cols: 5 } as const;

/** Para usar en los futuros puntos de entrada del servidor antes de certificar solvencia. */
export function parseCustomMission(input: unknown): Mission {
  const mission = parseMission(input);
  for (const dimension of ["rows", "cols"] as const) {
    if (mission.grid[dimension] > CUSTOM_MISSION_LIMITS[dimension]) {
      throw new ContractError([{
        code: "SCHEMA_INVALID",
        path: `grid.${dimension}`,
        message: "Las misiones personalizadas admiten como máximo 5 filas y 5 columnas.",
      }]);
    }
  }
  return mission;
}
