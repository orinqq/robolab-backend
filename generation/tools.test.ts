import { describe, expect, it, vi } from "vitest";
import {
  generate_map,
  validate_mission,
  evaluate_difficulty,
  save_mission,
} from "./tools";
import { GENERATION_POLICY } from "./contracts";
import {
  MISSION_PROMPT_VERSION,
  MISSION_SYSTEM_PROMPT,
} from "./prompts/mission-v1";

describe("herramientas del agente sin LLM ni base de datos", () => {
  it.each([2, 3, 4] as const)("construye y certifica el grado %i", (grade) => {
    const mission = generate_map(grade);
    expect(validate_mission(mission).ok).toBe(true);
    expect(evaluate_difficulty(mission)).toMatchObject({
      solutionStatus: "SOLVED",
      checkpointCount: grade === 2 ? 0 : grade === 3 ? 1 : 2,
    });
    expect(generate_map(grade)).not.toBe(mission);
  });
  it("no llama al repositorio para entradas malformadas o imposibles", async () => {
    const repository = { save: vi.fn().mockResolvedValue("guardada") };
    const mission = generate_map(2);
    await expect(save_mission(null, repository)).rejects.toThrow();
    await expect(
      save_mission({ ...mission, energyBudget: 1 }, repository),
    ).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
    expect(validate_mission({ ...mission, energyBudget: 1 })).toMatchObject({
      ok: false,
      issues: [{ code: "UNSOLVABLE" }],
    });
    expect(
      evaluate_difficulty({ ...mission, energyBudget: 1 }).minimumEnergy,
    ).toBeNull();
    await expect(save_mission(mission, repository)).resolves.toBe("guardada");
    expect(repository.save).toHaveBeenCalledExactlyOnceWith(mission);
  });
  it("propaga fallos de persistencia sin reintentos ni guardados duplicados", async () => {
    const repository = {
      save: vi.fn().mockRejectedValue(new Error("sin conexión")),
    };
    await expect(save_mission(generate_map(2), repository)).rejects.toThrow(
      "sin conexión",
    );
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
  it("versiona el prompt y limita las reparaciones futuras", () => {
    expect(MISSION_PROMPT_VERSION).toBe("mission-proposal/1");
    expect(MISSION_SYSTEM_PROMPT).toContain("solve_mission");
    expect(GENERATION_POLICY.maxRepairRetries).toBe(2);
  });
});
