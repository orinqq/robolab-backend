import type { Mission } from "./contracts";
import { COMMANDS } from "../game/program";
import type { MissionFamily } from "./mechanics";

/** Two corridors: short costly top row, longer cheap detour. */
export function mechanicFixture(family: MissionFamily): Mission {
  const delivery = family === "CHECKPOINT_DELIVERY";
  return {
    schemaVersion: 1, id: "mechanic-fixture", revision: 1, grade: 3,
    title: "Elige la ruta de reparto", objective: "Comparar sumas de costos y administrar energía.",
    initialHeading: 90, allowedCommands: [...COMMANDS],
    start: { row: 0, col: 0 }, goal: { row: 0, col: 3 },
    energyBudget: delivery ? 7 : 5,
    checkpoints: delivery ? [{ id: "entrega", position: { row: 2, col: 1 } }] : [],
    grid: { rows: 3, cols: 4, cells: Array.from({ length: 12 }, (_, i) => ({
      position: { row: Math.floor(i / 4), col: i % 4 },
      terrain: i === 1 || i === 2 ? "rough" : "plain",
      cost: i === 1 || i === 2 ? 8 : 1, obstacle: false,
    })) },
  };
}
