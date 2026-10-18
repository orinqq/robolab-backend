import { describe, expect, it, vi } from "vitest";
import { missionFixtures } from "../domain/mission/fixtures";
import { generateActivity } from "./orchestrator";
import { ProviderError } from "./providers/errors";
import type { MissionProvider } from "./contracts";
import { parseActivityRequest } from "./request";
const request = {
  objective: "Practicar sumas y planificación de recorridos.",
  grades: [2],
  difficulty: "balanced",
};
const provider = (
  propose = vi.fn().mockResolvedValue(missionFixtures[0]),
): MissionProvider => ({ name: "groq", model: "modelo-de-prueba", propose });

describe("agente educativo acotado", () => {
  it("no cancela streams después de terminar una respuesta válida", async () => {
    let signal: AbortSignal | undefined;
    const propose = vi.fn().mockImplementation(async (input) => {
      signal = input.signal;
      return missionFixtures[0];
    });
    await generateActivity(request, provider(propose));
    expect(signal?.aborted).toBe(false);
  });
  it("certifica la primera propuesta y conserva métricas y procedencia", async () => {
    const p = provider();
    const result = await generateActivity(request, p);
    expect(result[0]).toMatchObject({
      origin: "ai_generated",
      calls: 1,
      repairs: 0,
      metrics: { solutionStatus: "SOLVED" },
      mission: { objective: request.objective },
    });
    expect(p.propose).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...missionFixtures[0]!, start: { row: 99, col: 0 } },
    { ...missionFixtures[0]!, energyBudget: 1 },
  ])(
    "repara entradas inválidas enviando issues y la propuesta anterior",
    async (invalid) => {
      const propose = vi
        .fn()
        .mockResolvedValueOnce(invalid)
        .mockResolvedValueOnce(missionFixtures[0]);
      const result = await generateActivity(request, provider(propose));
      expect(result[0]).toMatchObject({
        origin: "ai_generated",
        calls: 2,
        repairs: 1,
      });
      expect(propose.mock.calls[1]![0].previousIssues).not.toHaveLength(0);
      expect(propose.mock.calls[1]![0].previousProposal).toEqual(invalid);
    },
  );
  it("repara JSON malformado sin devolver el cuerpo del proveedor", async () => {
    const propose = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError("SCHEMA_INVALID"))
      .mockResolvedValueOnce(missionFixtures[0]);
    expect(
      (await generateActivity(request, provider(propose)))[0]?.repairs,
    ).toBe(1);
  });
  it("agota exactamente dos reparaciones y ofrece una plantilla marcada", async () => {
    const p = provider(vi.fn().mockResolvedValue({}));
    const [result] = await generateActivity(request, p);
    expect(p.propose).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      origin: "template_fallback",
      calls: 3,
      repairs: 2,
      errorCode: "SCHEMA_INVALID",
      fallbackSatisfiesConstraints: true,
    });
  });
  it.each([
    "PROVIDER_AUTH",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_RATE_LIMIT",
  ] as const)("no repite errores operativos %s", async (code) => {
    const p = provider(vi.fn().mockRejectedValue(new ProviderError(code)));
    const [result] = await generateActivity(request, p);
    expect(p.propose).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      origin: "template_fallback",
      calls: 1,
      errorCode: code,
    });
  });
  it("impone timeout aunque el proveedor no coopere con AbortSignal", async () => {
    const p = provider(vi.fn().mockImplementation(() => new Promise(() => {})));
    const [result] = await generateActivity(request, p, { timeoutMs: 5 });
    expect(result).toMatchObject({
      origin: "template_fallback",
      calls: 1,
      errorCode: "PROVIDER_TIMEOUT",
    });
  });
  it("genera una propuesta por grado, con el mismo objetivo", async () => {
    const propose = vi
      .fn()
      .mockImplementation(async ({ request: r }) =>
        missionFixtures.find((m) => m.grade === r.grade),
      );
    const results = await generateActivity(
      { ...request, grades: [2, 3, 4] },
      provider(propose),
    );
    expect(results.map((r) => r.mission.grade)).toEqual([2, 3, 4]);
    expect(
      results.every((r) => r.mission.objective === request.objective),
    ).toBe(true);
    expect(propose).toHaveBeenCalledTimes(3);
  });
  it("comprueba grado y restricciones y advierte si el respaldo no las cumple", async () => {
    const p = provider();
    const [result] = await generateActivity(
      { ...request, constraints: { checkpoints: 2 } },
      p,
    );
    expect(result).toMatchObject({
      origin: "template_fallback",
      fallbackSatisfiesConstraints: false,
    });
    expect(result?.events[0]?.errorCode).toBe("SCHEMA_INVALID");
  });
  it("rechaza solicitudes vacías, grados repetidos y datos personales evidentes", () => {
    for (const input of [
      {},
      { ...request, grades: [] },
      { ...request, grades: [2, 2] },
      { ...request, objective: "El alumno se llama prueba@example.com" },
      { ...request, constraints: { checkpoints: 7 } },
    ])
      expect(() => parseActivityRequest(input)).toThrow();
  });
});
