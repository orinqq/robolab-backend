import type { Mission } from "../domain/mission/contracts";
import { MECHANICS, validateMechanic } from "../domain/mission/mechanics";
import type { MechanicEvidence, MissionFamily } from "../domain/mission/mechanics";
import { ContractError } from "../domain/mission/validation";
import { generateActivity, constraintIssues } from "./orchestrator";
import type { MissionProvider } from "./contracts";
import { parseActivityRequest } from "./request";
import type { ActivityRequest } from "./request";
import { validate_mission } from "./tools";

export type PedagogyMetadata = {
  schemaVersion: 1;
  missionId: string;
  missionRevision: number;
  family: MissionFamily;
  mathematicalObjective: string;
  concepts: readonly string[];
  rationale: string;
  requestedConstraints: ActivityRequest;
  verification: "verified" | "degraded_fallback";
  evidence?: MechanicEvidence;
  limitations: readonly string[];
};
/** JSON sidecar: never merges pedagogical fields into Mission v1. Recomputed, not LLM-authored. */
export function buildPedagogy(mission: Mission, input: unknown, fallback = false): PedagogyMetadata {
  const request = parseActivityRequest(input);
  if (!request.family) throw new Error("Selecciona una familia explícita.");
  const issues = constraintIssues(mission, request, mission.grade);
  if (!request.grades.includes(mission.grade)) issues.push({ code: "SCHEMA_INVALID", path: "grade", message: "Grado no solicitado." });
  if (issues.length && !fallback) throw new ContractError(issues);
  const result = validateMechanic(mission, request.family);
  if (!result.ok && !fallback) throw new ContractError(result.issues);
  return {
    schemaVersion: 1, missionId: mission.id, missionRevision: mission.revision,
    family: request.family, mathematicalObjective: request.objective,
    concepts: MECHANICS[request.family].concepts,
    rationale: MECHANICS[request.family].rationale,
    requestedConstraints: request,
    verification: fallback ? "degraded_fallback" : "verified",
    ...(result.ok && !fallback ? { evidence: result.evidence } : {}),
    limitations: [
      "La evidencia demuestra propiedades del tablero, no resultados de aprendizaje.",
      "La búsqueda de alternativas es conservadora y acotada; puede rechazar tableros válidos sin testigos encontrados.",
      ...(fallback ? ["El respaldo no acredita la familia ni el objetivo solicitado."] : []),
    ],
  };
}
/** Optional envelope for callers storing sidecars; legacy generateActivity keeps its exact shape. */
export async function generatePedagogicalActivity(input: unknown, provider: MissionProvider) {
  const request = parseActivityRequest(input);
  if (!request.family) throw new Error("Selecciona una familia explícita.");
  const proposals = await generateActivity(input, provider);
  return proposals.map(proposal => ({
    proposal,
    pedagogy: buildPedagogy(proposal.mission, request, proposal.origin === "template_fallback"),
  }));
}
/** Revalidates both mission and mechanic at an injected persistence boundary. */
export async function savePedagogicalMission<T>(
  input: unknown, request: unknown,
  repository: { save(mission: Mission, pedagogy: PedagogyMetadata): Promise<T> },
): Promise<T> {
  const validation = validate_mission(input);
  if (!validation.ok) throw new ContractError(validation.issues);
  const pedagogy = buildPedagogy(validation.value, request);
  return repository.save(validation.value, pedagogy);
}
