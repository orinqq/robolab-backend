import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { mechanicFixture } from "../domain/mission/mechanicsFixtures";
import { missionFixtures } from "../domain/mission/fixtures";
import { GroqProvider } from "../generation/providers/groq";
import { ProviderError } from "../generation/providers/errors";

const request = { objective: "Comparar sumas de costos y administrar energía.", grades: [3], family: "ROUTE_COMPARISON", difficulty: "balanced", constraints: { rows: 3, cols: 4, plainCost: 1, roughCost: 8 } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules);
  const [id, otherId] = await t.run(async ctx => [await ctx.db.insert("users", { name: "Ana" }), await ctx.db.insert("users", { name: "Beto" })]);
  return { t, teacher: t.withIdentity({ subject: `${id}|session` }), other: t.withIdentity({ subject: `${otherId}|session` }) };
}
async function generated() {
  const state = await setup();
  vi.spyOn(GroqProvider.prototype, "propose").mockResolvedValue(mechanicFixture("ROUTE_COMPARISON"));
  const runId = await state.teacher.action(api.aiGenerationActions.generate, { request });
  const ref = await state.teacher.mutation(api.aiMissions.createDraft, { runId, grade: 3 });
  return { ...state, runId, ref };
}
describe("misiones personalizadas Convex", () => {
  it("genera autorizadamente, guarda borrador idempotente y sidecar con identidad definitiva", async () => {
    const { teacher, runId, ref } = await generated();
    const run = await teacher.query(api.aiGeneration.get, { runId });
    expect(run).toMatchObject({ status: "completed", proposals: [{ origin: "ai_generated", calls: 1, repairs: 0 }] });
    expect(run).not.toHaveProperty("model");
    expect(await teacher.mutation(api.aiMissions.createDraft, { runId, grade: 3 })).toEqual(ref);
    const { mission, revision } = await teacher.query(api.aiMissions.get, { missionId: ref.missionId });
    expect(mission).toMatchObject({ kind: "ai_custom", availability: "not_available", origin: "ai_generated" });
    expect(revision).toMatchObject({ status: "draft", content: { id: ref.missionId, revision: 1 }, pedagogy: { missionId: ref.missionId, missionRevision: 1, verification: "verified", evidence: { budget: 5 } } });
    expect((await teacher.query(api.aiMissions.listMine, { paginationOpts: { cursor: null, numItems: 10 } })).page).toHaveLength(1);
  });
  it("edita y recalcula evidencia; rechaza edición inválida o versión obsoleta", async () => {
    const { teacher, ref } = await generated();
    const before = await teacher.query(api.aiMissions.getRevision, ref);
    const content = { ...before.content, title: "Título revisado", energyBudget: 6 };
    expect(await teacher.mutation(api.aiMissions.updateDraft, { ...ref, content, expectedEditVersion: 1 })).toBe(2);
    expect((await teacher.query(api.aiMissions.getRevision, ref)).pedagogy.evidence!.budget).toBe(6);
    await expect(teacher.mutation(api.aiMissions.updateDraft, { ...ref, content, expectedEditVersion: 1 })).rejects.toThrow();
    await expect(teacher.mutation(api.aiMissions.updateDraft, { ...ref, content: { ...content, energyBudget: 10000 }, expectedEditVersion: 2 })).rejects.toThrow();
    expect((await teacher.query(api.aiMissions.getRevision, ref)).editVersion).toBe(2);
  });
  it("rechaza costos y dimensiones que incumplen la solicitud aunque el mapa sea resoluble", async () => {
    const { teacher, ref } = await generated();
    const { content } = await teacher.query(api.aiMissions.getRevision, ref);
    await expect(teacher.mutation(api.aiMissions.updateDraft, { ...ref, expectedEditVersion: 1, content: { ...content, grid: { ...content.grid, cells: content.grid.cells.map(c => ({ ...c, cost: 1 })) } } })).rejects.toThrow();
  });
  it("publica administrativamente, conserva inmutabilidad y crea revisión con sidecar nuevo", async () => {
    const { teacher, ref } = await generated();
    const before = await teacher.query(api.aiMissions.getRevision, ref);
    await teacher.mutation(api.aiMissions.publish, { ...ref, expectedEditVersion: 1 });
    await expect(teacher.mutation(api.aiMissions.updateDraft, { ...ref, content: before.content, expectedEditVersion: 2 })).rejects.toThrow();
    await expect(teacher.mutation(api.aiMissions.publish, { ...ref, expectedEditVersion: 2 })).rejects.toThrow();
    const next = await teacher.mutation(api.aiMissions.createRevision, ref);
    const revision = await teacher.query(api.aiMissions.getRevision, next);
    expect(revision).toMatchObject({ number: 2, status: "draft", content: { revision: 2 }, pedagogy: { missionRevision: 2, missionId: ref.missionId } });
    expect((await teacher.query(api.aiMissions.getRevision, ref)).content).toEqual(before.content);
    await expect(teacher.mutation(api.aiMissions.createRevision, ref)).rejects.toThrow();
    expect((await teacher.query(api.aiMissions.get, { missionId: ref.missionId })).mission.availability).toBe("not_available");
    expect((await teacher.query(api.aiMissions.listRevisions, { missionId: ref.missionId, paginationOpts: { cursor: null, numItems: 10 } })).page).toHaveLength(2);
  });
  it("no confía en sidecars guardados al publicar: los vuelve a generar", async () => {
    const { t, teacher, ref } = await generated();
    await t.run(async ctx => {
      const revision = (await ctx.db.get(ref.revisionId))!;
      await ctx.db.patch(ref.revisionId, { pedagogy: { ...revision.pedagogy, missionRevision: 99, evidence: { ...revision.pedagogy.evidence!, budget: 999 } } });
    });
    await teacher.mutation(api.aiMissions.publish, { ...ref, expectedEditVersion: 1 });
    const revision = await teacher.query(api.aiMissions.getRevision, ref);
    expect(revision.pedagogy).toMatchObject({ missionRevision: 1, evidence: { budget: 5 } });
  });
  it("revalida tablero alterado al publicar y rechaza certificación obsoleta", async () => {
    const { t, teacher, ref } = await generated();
    await t.run(async ctx => {
      const r = (await ctx.db.get(ref.revisionId))!;
      await ctx.db.patch(ref.revisionId, { content: { ...r.content, energyBudget: 10000 } });
    });
    await expect(teacher.mutation(api.aiMissions.publish, { ...ref, expectedEditVersion: 1 })).rejects.toThrow();
    expect((await teacher.query(api.aiMissions.getRevision, ref)).status).toBe("draft");
  });
  it("protege generación, borradores y publicación entre docentes y sin sesión", async () => {
    const { t, teacher, other, ref, runId } = await generated();
    for (const actor of [t, other]) {
      await expect(actor.query(api.aiGeneration.get, { runId })).rejects.toThrow();
      await expect(actor.query(api.aiMissions.get, { missionId: ref.missionId })).rejects.toThrow();
      await expect(actor.query(api.aiMissions.getRevision, ref)).rejects.toThrow();
      await expect(actor.mutation(api.aiMissions.createDraft, { runId, grade: 3 })).rejects.toThrow();
      await expect(actor.mutation(api.aiMissions.publish, { ...ref, expectedEditVersion: 1 })).rejects.toThrow();
      await expect(actor.mutation(api.aiMissions.createRevision, ref)).rejects.toThrow();
    }
    const { content } = await teacher.query(api.aiMissions.getRevision, ref);
    await expect(other.mutation(api.aiMissions.updateDraft, { ...ref, content, expectedEditVersion: 1 })).rejects.toThrow();
    const propose = vi.mocked(GroqProvider.prototype.propose);
    propose.mockClear();
    await expect(t.action(api.aiGenerationActions.generate, { request })).rejects.toThrow();
    expect(propose).not.toHaveBeenCalled();
  });
  it.each([{ constraints: { rows: 6 } }, { constraints: { cols: 6 } }, { constraints: { plainCost: 0 } }, { family: "RECHARGE" }, { family: "SYMMETRY" }, { family: undefined }])("rechaza solicitud antes de Groq: %j", async change => {
    const { teacher } = await setup();
    const propose = vi.spyOn(GroqProvider.prototype, "propose");
    await expect(teacher.action(api.aiGenerationActions.generate, { request: { ...request, ...change } })).rejects.toThrow();
    expect(propose).not.toHaveBeenCalled();
  });
  it.each(["ENERGY_OPTIMIZATION", "CHECKPOINT_DELIVERY", "ROUTE_COMPARISON"] as const)("genera y persiste familia %s", async family => {
    const { teacher } = await setup();
    vi.spyOn(GroqProvider.prototype, "propose").mockResolvedValue(mechanicFixture(family));
    const runId = await teacher.action(api.aiGenerationActions.generate, { request: { ...request, family } });
    const ref = await teacher.mutation(api.aiMissions.createDraft, { runId, grade: 3 });
    expect((await teacher.query(api.aiMissions.getRevision, ref)).pedagogy.family).toBe(family);
  });
  it("identifica fallback y permite borrador degradado pero bloquea su publicación incompatible", async () => {
    const { teacher } = await setup();
    const propose = vi.spyOn(GroqProvider.prototype, "propose").mockRejectedValue(new ProviderError("PROVIDER_AUTH"));
    const runId = await teacher.action(api.aiGenerationActions.generate, { request });
    expect(propose).toHaveBeenCalledTimes(1);
    const ref = await teacher.mutation(api.aiMissions.createDraft, { runId, grade: 3 });
    const { mission, revision } = await teacher.query(api.aiMissions.get, { missionId: ref.missionId });
    expect(mission.origin).toBe("template_fallback");
    expect(revision.pedagogy).toMatchObject({ verification: "degraded_fallback", missionId: ref.missionId });
    expect(revision.pedagogy.evidence).toBeUndefined();
    await expect(teacher.mutation(api.aiMissions.publish, { ...ref, expectedEditVersion: 1 })).rejects.toThrow();
  });
  it("repara mecánica inválida sin superar tres llamadas y conserva el fallback real", async () => {
    const { teacher } = await setup();
    const propose = vi.spyOn(GroqProvider.prototype, "propose").mockResolvedValue(missionFixtures[1]);
    const runId = await teacher.action(api.aiGenerationActions.generate, { request });
    expect(propose).toHaveBeenCalledTimes(3);
    const run = await teacher.query(api.aiGeneration.get, { runId });
    expect(run.proposals[0]).toMatchObject({ origin: "template_fallback", calls: 3, repairs: 2 });
    expect(propose.mock.calls[1]![0].previousIssues.length).toBeGreaterThan(0);
  });
  it("un fallback corregido puede certificarse sin cambiar su origen histórico", async () => {
    const { teacher } = await setup();
    vi.spyOn(GroqProvider.prototype, "propose").mockRejectedValue(new ProviderError("PROVIDER_NOT_CONFIGURED"));
    const runId = await teacher.action(api.aiGenerationActions.generate, { request });
    const ref = await teacher.mutation(api.aiMissions.createDraft, { runId, grade: 3 });
    const content = { ...mechanicFixture("ROUTE_COMPARISON"), id: ref.missionId, revision: 1 };
    await teacher.mutation(api.aiMissions.updateDraft, { ...ref, content, expectedEditVersion: 1 });
    await teacher.mutation(api.aiMissions.publish, { ...ref, expectedEditVersion: 2 });
    const result = await teacher.query(api.aiMissions.get, { missionId: ref.missionId });
    expect(result.mission.origin).toBe("template_fallback");
    expect(result.revision.pedagogy.verification).toBe("verified");
  });
  it("registra fallo de configuración sin revelar variables del proveedor", async () => {
    const { teacher } = await setup();
    const propose = vi.spyOn(GroqProvider.prototype, "propose");
    vi.stubEnv("LLM_MODEL", "configuración inválida!");
    await expect(teacher.action(api.aiGenerationActions.generate, { request })).rejects.toThrow("No pudimos completar");
    expect(propose).not.toHaveBeenCalled();
  });
  it("rechaza referencias cruzadas e identidad modificada", async () => {
    const { teacher, other, ref } = await generated();
    const otherRunId = await other.action(api.aiGenerationActions.generate, { request });
    const otherRef = await other.mutation(api.aiMissions.createDraft, { runId: otherRunId, grade: 3 });
    await expect(teacher.query(api.aiMissions.getRevision, { missionId: ref.missionId, revisionId: otherRef.revisionId })).rejects.toThrow();
    const { content } = await teacher.query(api.aiMissions.getRevision, ref);
    await expect(teacher.mutation(api.aiMissions.updateDraft, { ...ref, content: { ...content, id: "otra-mision" }, expectedEditVersion: 1 })).rejects.toThrow();
    await expect(teacher.mutation(api.aiMissions.updateDraft, { ...ref, content: { ...content, revision: 99 }, expectedEditVersion: 1 })).rejects.toThrow();
  });
  it("limita reparaciones, concurrencia y rechaza resultados tardíos", async () => {
    const { t, teacher, other } = await setup();
    const first = await teacher.mutation(internal.aiGeneration.begin, { request: { ...request, family: "ROUTE_COMPARISON", difficulty: "balanced", grades: [3] } });
    await expect(teacher.mutation(internal.aiGeneration.begin, { request: { ...request, family: "ROUTE_COMPARISON", difficulty: "balanced", grades: [3] } })).rejects.toThrow();
    await other.mutation(internal.aiGeneration.begin, { request: { ...request, family: "ROUTE_COMPARISON", difficulty: "balanced", grades: [3] } });
    const thirdId = await t.run(ctx => ctx.db.insert("users", { name: "Caro" }));
    await expect(t.withIdentity({ subject: `${thirdId}|s` }).mutation(internal.aiGeneration.begin, { request: { ...request, family: "ROUTE_COMPARISON", difficulty: "balanced", grades: [3] } })).rejects.toThrow();
    await t.run(ctx => ctx.db.patch(first, { leaseUntil: Date.now() - 1 }));
    await expect(teacher.mutation(internal.aiGeneration.finish, { runId: first, proposals: [{ mission: { ...missionFixtures[1]!, allowedCommands: [...missionFixtures[1]!.allowedCommands], checkpoints: [...missionFixtures[1]!.checkpoints], grid: { ...missionFixtures[1]!.grid, cells: [...missionFixtures[1]!.grid.cells] } }, origin: "template_fallback", calls: 1, repairs: 0 }] })).rejects.toThrow();
  });
});
