import { describe, expect, it } from "vitest";
import { missionFixtures } from "./fixtures";
import { parseMission, parseProgram, ContractError } from "./validation";
import { executeMission, solveMission, createAttempt } from "./engine";
import { compile, move, repeat } from "../game/program";
import { toRobotText } from "../robot/protocol";

const program = (commands: readonly string[]) => ({
  schemaVersion: 1,
  commands,
});
const fixture = () => structuredClone(missionFixtures[0]!);

describe("contratos de misiones v1", () => {
  it.each([0, 1, 2])(
    "serializa y resuelve el fixture %i sin servicios externos",
    (index) => {
      const mission = parseMission(
        JSON.parse(JSON.stringify(missionFixtures[index])),
      );
      const solved = solveMission(mission);
      expect(solved.status).toBe("SOLVED");
      if (solved.status !== "SOLVED") return;
      const trace = executeMission(mission, solved.program);
      expect(trace.outcome).toBe("SUCCESS");
      expect(trace.energyUsed).toBe(solved.cost);
      expect(trace.visitedCheckpoints).toHaveLength(mission.checkpoints.length);
      expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
      const attempt = createAttempt(
        "intento-1",
        mission,
        solved.program,
        100,
        200,
      );
      expect(JSON.parse(JSON.stringify(attempt))).toEqual(attempt);
      expect(toRobotText(solved.program.commands.map(move))).toHaveLength(
        solved.program.commands.length,
      );
    },
  );

  it.each([-1, 0.5, 30, NaN, Infinity])(
    "rechaza coordenadas inválidas %s",
    (row) => {
      expect(() =>
        parseMission({ ...fixture(), start: { row, col: 0 } }),
      ).toThrow(ContractError);
    },
  );
  it("rechaza dimensiones, celdas ausentes, repetidas y versiones desconocidas", () => {
    const mission = fixture();
    for (const change of [
      { schemaVersion: 2 },
      { grid: { ...mission.grid, rows: 0 } },
      { grid: { ...mission.grid, cells: mission.grid.cells.slice(1) } },
      {
        grid: {
          ...mission.grid,
          cells: mission.grid.cells.map(() => mission.grid.cells[0]),
        },
      },
      { allowedCommands: [] },
      { initialHeading: 45 },
      { energyBudget: Infinity },
    ])
      expect(() => parseMission({ ...mission, ...change })).toThrow(
        ContractError,
      );
  });
  it.each([0, -1, 0.5, NaN, Infinity])(
    "rechaza costos no enteros positivos %s",
    (cost) => {
      const mission = fixture();
      expect(() =>
        parseMission({
          ...mission,
          grid: {
            ...mission.grid,
            cells: mission.grid.cells.map((c) => ({ ...c, cost })),
          },
        }),
      ).toThrow(ContractError);
    },
  );
  it("rechaza obstáculos en inicio, meta y estaciones y posiciones incompatibles", () => {
    const mission = structuredClone(missionFixtures[1]!);
    for (const position of [
      mission.start,
      mission.goal,
      mission.checkpoints[0]!.position,
    ]) {
      expect(() =>
        parseMission({
          ...mission,
          grid: {
            ...mission.grid,
            cells: mission.grid.cells.map((c) =>
              c.position.row === position.row && c.position.col === position.col
                ? { ...c, obstacle: true }
                : c,
            ),
          },
        }),
      ).toThrow(ContractError);
    }
    expect(() =>
      parseMission({
        ...mission,
        checkpoints: [{ id: "p", position: mission.start }],
      }),
    ).toThrow(ContractError);
    expect(() =>
      parseMission({
        ...mission,
        checkpoints: [mission.checkpoints[0], mission.checkpoints[0]],
      }),
    ).toThrow(ContractError);
  });
  it("rechaza comandos desconocidos, vacíos, excesivos o no permitidos antes de ejecutar", () => {
    for (const commands of [
      ["U"],
      ["STOP"],
      [],
      Array(129).fill("FORWARD"),
      [null],
    ]) {
      expect(() => parseProgram(program(commands))).toThrow(ContractError);
    }
    expect(() =>
      executeMission(
        { ...fixture(), allowedCommands: ["FORWARD"] },
        program(["TURN_LEFT"]),
      ),
    ).toThrow(ContractError);
    expect(
      parseProgram(program(compile([repeat(2, [move("FORWARD")])]))).commands,
    ).toHaveLength(2);
  });
});

describe("reglas deterministas", () => {
  it("cobra la entrada, no el inicio ni los giros, y acepta presupuesto exacto", () => {
    const mission = fixture();
    const trace = executeMission(
      mission,
      program(["TURN_LEFT", "TURN_RIGHT", "FORWARD", "FORWARD", "FORWARD"]),
    );
    expect(trace.outcome).toBe("SUCCESS");
    expect(trace.energyUsed).toBe(3);
    expect(trace.steps[0]?.cost).toBe(0);
    expect(
      executeMission(
        { ...mission, energyBudget: 2 },
        program(["FORWARD", "FORWARD", "FORWARD"]),
      ),
    ).toMatchObject({
      outcome: "ENERGY_EXCEEDED",
      energyUsed: 2,
      failedStep: 3,
    });
  });
  it("detiene colisiones y bordes sin cobrar ni mover", () => {
    expect(executeMission(fixture(), program(["BACKWARD"]))).toMatchObject({
      outcome: "OUT_OF_BOUNDS",
      energyUsed: 0,
      failedStep: 1,
      steps: [],
    });
    const mission = structuredClone(missionFixtures[1]!);
    expect(
      executeMission(mission, program(["TURN_RIGHT", "FORWARD"])),
    ).toMatchObject({ outcome: "COLLISION", energyUsed: 0, failedStep: 2 });
  });
  it("visita estaciones una vez, cobra reingresos y deja pasar por la meta antes de completarlas", () => {
    const base = fixture();
    const mission = {
      ...base,
      goal: { row: 0, col: 1 },
      checkpoints: [{ id: "fin", position: { row: 0, col: 3 } }],
      energyBudget: 6,
    };
    const trace = executeMission(
      mission,
      program(["FORWARD", "FORWARD", "FORWARD", "BACKWARD", "BACKWARD"]),
    );
    expect(trace).toMatchObject({
      outcome: "SUCCESS",
      energyUsed: 5,
      visitedCheckpoints: ["fin"],
    });
    expect(executeMission(mission, program(["FORWARD"])).outcome).toBe(
      "MISSING_CHECKPOINTS",
    );
    expect(executeMission(base, program(["FORWARD"])).outcome).toBe(
      "INCOMPLETE",
    );
    expect(
      executeMission(
        base,
        program(["FORWARD", "FORWARD", "FORWARD", "BACKWARD"]),
      ).steps,
    ).toHaveLength(3);
  });
  it("distingue mapas imposibles, energía insuficiente y límites de búsqueda", () => {
    const mission = fixture();
    const blocked = {
      ...mission,
      grid: {
        ...mission.grid,
        cells: mission.grid.cells.map((c, i) =>
          i === 1 ? { ...c, obstacle: true } : c,
        ),
      },
    };
    expect(solveMission(blocked).status).toBe("UNSOLVABLE");
    expect(solveMission({ ...mission, energyBudget: 2 }).status).toBe(
      "UNSOLVABLE",
    );
    expect(solveMission(mission, 1).status).toBe("SEARCH_LIMIT");
    expect(() =>
      createAttempt("a", mission, program(["FORWARD"]), 200, 100),
    ).toThrow(ContractError);
  });
  it("elige la ruta de menor energía aunque requiera más movimientos", () => {
    const base = fixture();
    const mission = {
      ...base,
      goal: { row: 0, col: 2 },
      energyBudget: 10,
      grid: {
        rows: 2,
        cols: 3,
        cells: Array.from({ length: 6 }, (_, i) => ({
          position: { row: Math.floor(i / 3), col: i % 3 },
          terrain: "plain",
          obstacle: false,
          cost: i === 1 ? 9 : 1,
        })),
      },
    };
    const solved = solveMission(mission);
    expect(solved.status).toBe("SOLVED");
    if (solved.status !== "SOLVED") return;
    expect(solved.cost).toBe(4);
    expect(executeMission(mission, solved.program).energyUsed).toBe(4);
    expect(
      executeMission(mission, program(["FORWARD", "FORWARD"])).energyUsed,
    ).toBe(10);
  });
  it("el solver respeta paleta restringida y detecta estaciones inaccesibles", () => {
    expect(
      solveMission({ ...fixture(), allowedCommands: ["TURN_LEFT"] }).status,
    ).toBe("UNSOLVABLE");
    const base = fixture();
    const mission = {
      ...base,
      goal: { row: 0, col: 1 },
      checkpoints: [{ id: "aislada", position: { row: 0, col: 3 } }],
      grid: {
        ...base.grid,
        cells: base.grid.cells.map((c, i) =>
          i === 2 ? { ...c, obstacle: true } : c,
        ),
      },
    };
    expect(solveMission(mission).status).toBe("UNSOLVABLE");
  });
  it("rechaza estructuras no JSON y descarta propiedades extra sin mutar la entrada", () => {
    for (const input of [
      null,
      [],
      "misión",
      4,
      {},
      { ...fixture(), checkpoints: null },
    ]) {
      expect(() => parseMission(input)).toThrow(ContractError);
    }
    const input = { ...fixture(), arbitraryRule: "ignorar energía" };
    const parsed = parseMission(input);
    expect(parsed).not.toHaveProperty("arbitraryRule");
    expect(parsed.grid.cells).not.toBe(input.grid.cells);
    const p = parseProgram(JSON.parse(JSON.stringify(program(["FORWARD"]))));
    expect(p).toEqual(program(["FORWARD"]));
  });
});
