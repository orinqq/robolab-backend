import process from "node:process";
import { it, expect } from "vitest";
import { MECHANICS } from "../domain/mission/mechanics";
import type { MissionFamily } from "../domain/mission/mechanics";
import { generatePedagogicalActivity } from "./pedagogy";
import { GroqProvider } from "./providers/groq";

// Explicit opt-in only. One family, one grade, at most 3 paid requests per invocation.
const enabled = process.env.ROBOLAB_GROQ_EVAL === "1";
it.skipIf(!enabled)("evaluación controlada de una familia con Groq real", async () => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Configura GROQ_API_KEY en el entorno; no se registra su valor.");
  const family = process.env.ROBOLAB_EVAL_FAMILY ?? "ROUTE_COMPARISON";
  if (!Object.hasOwn(MECHANICS, family)) throw new Error("Familia no soportada.");
  const provider = new GroqProvider(key, process.env.LLM_MODEL || undefined);
  const [entry] = await generatePedagogicalActivity({
    objective: "Comparar sumas de costos y elegir un recorrido con presupuesto limitado.",
    family: family as MissionFamily, grades: [3], difficulty: "balanced",
    constraints: { rows: 3, cols: 4, plainCost: 1, roughCost: 8, minRough: 1,
      checkpoints: family === "CHECKPOINT_DELIVERY" ? 1 : 0 },
  }, provider);
  const p = entry!.proposal;
  console.info(JSON.stringify({
    family, model: p.model, promptVersion: p.promptVersion, calls: p.calls,
    repairs: p.repairs, origin: p.origin, errorCode: p.errorCode,
    verification: entry!.pedagogy.verification,
    minimumEnergy: entry!.pedagogy.evidence?.minimumEnergy,
    alternativeCost: entry!.pedagogy.evidence?.alternative?.cost,
  }));
  expect(p.calls).toBeLessThanOrEqual(3);
  // A fallback is a reported failure of the live evaluation, never a pass.
  expect(p.origin).toBe("ai_generated");
  expect(entry!.pedagogy.verification).toBe("verified");
}, 95000);
