import { COMMANDS } from "../game/program";
import type { Mission } from "./contracts";

/** Fixtures educativos de respaldo; no afirman una dificultad pedagógica validada. */
function fixture(
  grade: 2 | 3 | 4,
  layout: readonly string[],
  energyBudget: number,
): Mission {
  return {
    schemaVersion: 1,
    id: `primaria-${grade}-v1`,
    revision: 1,
    title: {
      2: "Lleva los libros",
      3: "Visita la biblioteca",
      4: "Reparte con energía limitada",
    }[grade],
    objective: {
      2: "Contar desplazamientos hasta tres.",
      3: "Planificar una parada y sumar costos.",
      4: "Comparar recorridos con dos paradas y distintos costos.",
    }[grade],
    grade,
    initialHeading: 90,
    energyBudget,
    allowedCommands: [...COMMANDS],
    start: { row: 0, col: 0 },
    goal: { row: layout.length - 1, col: layout[0]!.length - 1 },
    checkpoints:
      grade === 2
        ? []
        : grade === 3
          ? [{ id: "biblioteca", position: { row: 0, col: 2 } }]
          : [
              { id: "biblioteca", position: { row: 0, col: 3 } },
              { id: "aula", position: { row: 2, col: 0 } },
            ],
    grid: {
      rows: layout.length,
      cols: layout[0]!.length,
      cells: layout.flatMap((line, row) =>
        [...line].map((ch, col) => ({
          position: { row, col },
          terrain: ch === "3" ? ("rough" as const) : ("plain" as const),
          obstacle: ch === "#",
          cost: ch === "3" ? 3 : 1,
        })),
      ),
    },
  };
}
export const missionFixtures: readonly Mission[] = [
  fixture(2, ["...."], 3),
  fixture(3, ["....", "##3.", "...."], 7),
  fixture(4, ["....", ".#3.", "....", ".3.."], 12),
];
