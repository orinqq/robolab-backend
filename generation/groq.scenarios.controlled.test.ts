import process from "node:process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { evaluationScenarios, preflightEvaluation } from "./evaluationScenarios";
import { GroqProvider, DEFAULT_GROQ_MODEL } from "./providers/groq";
import { generateActivity, constraintIssues } from "./orchestrator";
import { buildPedagogy } from "./pedagogy";
import { validate_mission } from "./tools";
import { executeMission, solveMission } from "../domain/mission/engine";
import { validateMechanic } from "../domain/mission/mechanics";
import type { MissionProvider } from "./contracts";

/** Opt-in separado del test histórico. Un único lote, sin nuevas rondas automáticas. */
it.skipIf(process.env.ROBOLAB_GROQ_SCENARIOS !== "1")("evalúa A/B/C secuencialmente con un máximo global de nueve HTTP", async () => {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("Configura GROQ_API_KEY sin registrarla.");
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_GROQ_MODEL;
  if (!/^[a-zA-Z0-9_./-]{1,100}$/.test(model)) throw new Error("Configuración de modelo inválida.");
  const directory = resolve("node_modules/.cache/robolab-groq-evaluation");
  mkdirSync(directory, { recursive: true });
  const artifact = resolve(directory, "results.json");
  // Impide repetir accidentalmente la misma evaluación al relanzar la suite.
  if (existsSync(artifact)) throw new Error("Ya existe el artefacto de este lote; no se repiten llamadas.");
  let httpCalls = 0;
  const http: { call: number; status?: number; durationMs?: number; transportError?: boolean }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    if (httpCalls >= 9) throw new Error("Presupuesto HTTP agotado.");
    const call = ++httpCalls;
    const started = Date.now();
    const record: typeof http[number] = { call };
    http.push(record);
    try {
      const response = await fetch(input, init);
      record.status = response.status;
      return response;
    } catch {
      record.transportError = true;
      throw new Error("Fallo de transporte HTTP.");
    } finally { record.durationMs = Date.now() - started; }
  };
  const provider = new GroqProvider(key, model, fetchImpl);
  const results: unknown[] = [];
  const save = () => writeFileSync(artifact, JSON.stringify({
    schemaVersion: 1, evaluatedAt: new Date().toISOString(), model, httpCalls, http, results,
    remoteConvexVerified: false,
  }, null, 2), { mode: 0o600 });
  save();
  for (const scenario of evaluationScenarios) {
    const { request, issues: preflightIssues } = preflightEvaluation(scenario);
    if (preflightIssues.length) {
      results.push({ id: scenario.id, request, preflightIssues, skipped: true, httpCalls: 0 });
      save();
      continue;
    }
    const attempts: unknown[] = [];
    const observed: MissionProvider = {
      name: provider.name, model: provider.model,
      async propose(input) {
        const attempt = { previousIssues: input.previousIssues };
        try {
          const raw = await provider.propose(input);
          const validation = validate_mission(raw);
          const constraints = validation.ok ? constraintIssues(validation.value, request, request.grades[0]!) : [];
          // Solo JSON de misión ya validado: no se registran cuerpos arbitrarios ni headers.
          attempts.push({ ...attempt, validation, constraints });
          return raw;
        } catch (error) {
          attempts.push({ ...attempt, providerError: error instanceof Error && "code" in error ? error.code : "UNKNOWN" });
          throw error;
        }
      },
    };
    const initialCalls = httpCalls;
    const started = Date.now();
    try {
      const [proposal] = await generateActivity(request, observed);
      if (!proposal) throw new Error("Sin propuesta.");
      const mission = proposal.mission;
      const validation = validate_mission(mission);
      const solution = solveMission(mission);
      const mechanic = validateMechanic(mission, request.family!);
      const constraints = constraintIssues(mission, request, request.grades[0]!);
      const pedagogy = buildPedagogy(mission, request, proposal.origin === "template_fallback");
      const success = proposal.origin === "ai_generated" && validation.ok && solution.status === "SOLVED" && mechanic.ok && constraints.length === 0;
      results.push({
        id: scenario.id, request, preflightIssues, httpCalls: httpCalls - initialCalls,
        totalMs: Date.now() - started, success, proposal, validation, solution, mechanic, constraints, pedagogy, attempts,
        replay: solution.status === "SOLVED" ? executeMission(mission, solution.program) : null,
        summary: {
          rows: mission.grid.rows, cols: mission.grid.cols,
          obstacles: mission.grid.cells.filter(c => c.obstacle).length,
          checkpoints: mission.checkpoints.length,
          terrainCosts: { plain: [...new Set(mission.grid.cells.filter(c => c.terrain === "plain").map(c => c.cost))], rough: [...new Set(mission.grid.cells.filter(c => c.terrain === "rough").map(c => c.cost))] },
          budget: mission.energyBudget,
          minimumEnergy: solution.status === "SOLVED" ? solution.cost : null,
          commands: solution.status === "SOLVED" ? solution.program.commands.length : null,
        },
      });
      console.info(JSON.stringify({ case: scenario.id, success, calls: httpCalls - initialCalls, repairs: proposal.repairs, origin: proposal.origin, totalMs: Date.now() - started }));
    } catch {
      results.push({ id: scenario.id, request, success: false, totalMs: Date.now() - started, httpCalls: httpCalls - initialCalls, error: "EVALUATION_FAILED", attempts });
    }
    save();
  }
  expect(httpCalls).toBeLessThanOrEqual(9);
  expect(results).toHaveLength(3);
  // El artefacto se guarda antes de fallar: fallback nunca cuenta como éxito del modelo.
  expect(results.every(r => !!r && typeof r === "object" && "success" in r && r.success === true)).toBe(true);
}, 285000);
