import { ConvexError } from "convex/values";
import { parseCustomMission } from "../../domain/mission/custom";
import { ContractError } from "../../domain/mission/validation";
import { validate_mission } from "../../generation/tools";
import { buildPedagogy } from "../../generation/pedagogy";
import { parseActivityRequest } from "../../generation/request";

export function parseAIRequest(input: unknown) {
  try {
    const parsed = parseActivityRequest(input);
    if (!parsed.family) throw new ConvexError("Selecciona una familia matemática.");
    return { ...parsed, grades: [...parsed.grades], family: parsed.family, constraints: { ...parsed.constraints } };
  } catch (error) {
    if (error instanceof ContractError) throw new ConvexError(error.message);
    throw error;
  }
}
/** Deep mutable JSON DTO for Convex transport; all inputs have already been parsed. */
export function certifyAI(input: unknown, requestInput: unknown, fallback = false) {
  try {
    const mission = parseCustomMission(input);
    const valid = validate_mission(mission);
    if (!valid.ok) throw new ContractError(valid.issues);
    const metadata = buildPedagogy(mission, parseAIRequest(requestInput), fallback);
    const { evidence, ...metadataFields } = metadata;
    return {
      content: {
        ...mission, grid: { ...mission.grid, cells: mission.grid.cells.map(c => ({ ...c })) },
        checkpoints: mission.checkpoints.map(c => ({ ...c })), allowedCommands: [...mission.allowedCommands],
      },
      pedagogy: {
        ...metadataFields, concepts: [...metadata.concepts], limitations: [...metadata.limitations],
        requestedConstraints: parseAIRequest(metadata.requestedConstraints),
        ...(evidence ? { evidence: {
          schemaVersion: evidence.schemaVersion, family: evidence.family, minimumEnergy: evidence.minimumEnergy,
          budget: evidence.budget, solution: { ...evidence.solution, commands: [...evidence.solution.commands] },
          ...(evidence.alternative ? { alternative: { ...evidence.alternative, program: { ...evidence.alternative.program, commands: [...evidence.alternative.program.commands] } } } : {}),
          ...(evidence.checkpointBypass ? { checkpointBypass: { ...evidence.checkpointBypass, program: { ...evidence.checkpointBypass.program, commands: [...evidence.checkpointBypass.program.commands] } } } : {}),
        } } : {}),
      },
    };
  } catch (error) {
    if (error instanceof ContractError) throw new ConvexError({ code: "AI_VALIDATION_FAILED", message: "Revisa el tablero y las restricciones matemáticas.", issues: error.issues.map(i => ({ ...i })) });
    throw error;
  }
}
