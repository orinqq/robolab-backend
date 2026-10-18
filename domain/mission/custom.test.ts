import { describe, expect, it } from "vitest";
import { COMMANDS } from "../game/program";
import type { Mission } from "./contracts";
import { parseCustomMission } from "./custom";
import { executeMission, solveMission } from "./engine";
import { parseMission } from "./validation";

function rectangle(rows: number, cols: number): Mission {
  return {
    schemaVersion: 1, id: "custom-rectangle", revision: 1,
    title: "Ruta personalizada", objective: "Sumar los costos del recorrido.",
    grade: 3, initialHeading: 90, energyBudget: 100,
    allowedCommands: [...COMMANDS], start: { row: 0, col: 0 },
    goal: { row: rows - 1, col: cols - 1 },
    checkpoints: [{ id: "estacion", position: { row: 0, col: cols - 1 } }],
    grid: { rows, cols, cells: Array.from({ length: rows * cols }, (_, i) => ({
      position: { row: Math.floor(i / cols), col: i % cols },
      terrain: i === 1 ? "rough" : "plain", cost: i === 1 ? 3 : 1,
      obstacle: false,
    })) },
  };
}

describe("política inicial de misiones personalizadas", () => {
  it.each([[3, 4], [5, 5], [4, 3]])("certifica y ejecuta %ix%i", (rows, cols) => {
    const mission = parseCustomMission(rectangle(rows, cols));
    const solved = solveMission(mission);
    expect(solved.status).toBe("SOLVED");
    if (solved.status !== "SOLVED") throw new Error("Sin solución");
    const trace = executeMission(mission, solved.program);
    expect(trace.outcome).toBe("SUCCESS");
    expect(trace.visitedCheckpoints).toEqual(["estacion"]);
    expect(trace.energyUsed).toBe(solved.cost);
    expect(trace.energyUsed).toBe(trace.steps.reduce((sum, step) => sum + step.cost, 0));
  });

  it.each([[6, 5], [5, 6], [6, 6], [0, 4], [3, 0], [2.5, 4]])(
    "rechaza dimensiones %ix%i", (rows, cols) => {
      expect(() => parseCustomMission(rectangle(rows, cols))).toThrow();
    },
  );

  it("conserva el contrato original para dimensiones mayores", () => {
    expect(parseMission(rectangle(6, 6)).grid.rows).toBe(6);
    expect(() => parseCustomMission(rectangle(6, 6))).toThrow(/5/);
  });

  it("cobra por entrar, deja giros gratis y exige la estación", () => {
    const mission = parseCustomMission(rectangle(3, 4));
    const trace = executeMission(mission, { schemaVersion: 1, commands: ["FORWARD", "TURN_RIGHT"] });
    expect(trace.steps.map((step) => step.cost)).toEqual([3, 0]);
    expect(trace.energyUsed).toBe(3);
    const bypass = ["TURN_RIGHT", "FORWARD", "FORWARD", "TURN_LEFT", "FORWARD", "FORWARD", "FORWARD"];
    expect(executeMission(mission, { schemaVersion: 1, commands: bypass }).outcome).toBe("MISSING_CHECKPOINTS");
    expect(executeMission({ ...mission, energyBudget: 2 }, { schemaVersion: 1, commands: ["FORWARD"] }).outcome).toBe("ENERGY_EXCEEDED");
  });
});
