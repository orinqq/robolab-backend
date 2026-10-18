import { v } from "convex/values";

// Forma de almacenamiento/transporte. Las reglas y límites viven en domain/mission.
const position = v.object({ row: v.number(), col: v.number() });
export const missionContent = v.object({
  schemaVersion: v.literal(1),
  id: v.string(),
  revision: v.number(),
  title: v.string(),
  objective: v.string(),
  grade: v.union(v.literal(2), v.literal(3), v.literal(4)),
  grid: v.object({
    rows: v.number(),
    cols: v.number(),
    cells: v.array(
      v.object({
        position,
        terrain: v.union(v.literal("plain"), v.literal("rough")),
        obstacle: v.boolean(),
        cost: v.number(),
      }),
    ),
  }),
  start: position,
  goal: position,
  initialHeading: v.union(
    v.literal(0),
    v.literal(90),
    v.literal(180),
    v.literal(270),
  ),
  checkpoints: v.array(v.object({ id: v.string(), position })),
  energyBudget: v.number(),
  allowedCommands: v.array(
    v.union(
      v.literal("FORWARD"),
      v.literal("BACKWARD"),
      v.literal("TURN_LEFT"),
      v.literal("TURN_RIGHT"),
    ),
  ),
});

export const family = v.union(v.literal("ENERGY_OPTIMIZATION"), v.literal("CHECKPOINT_DELIVERY"), v.literal("ROUTE_COMPARISON"));
export const request = v.object({
  objective: v.string(), grades: v.array(v.union(v.literal(2), v.literal(3), v.literal(4))),
  family, difficulty: v.union(v.literal("guided"), v.literal("balanced"), v.literal("challenge")),
  constraints: v.object({
    rows: v.optional(v.number()), cols: v.optional(v.number()),
    plainCost: v.optional(v.number()), roughCost: v.optional(v.number()), minRough: v.optional(v.number()),
    checkpoints: v.optional(v.number()), minObstacles: v.optional(v.number()), maxEnergy: v.optional(v.number()),
  }),
});
export const origin = v.union(v.literal("ai_generated"), v.literal("template_fallback"));
export const program = v.object({ schemaVersion: v.literal(1), commands: missionContent.fields.allowedCommands });
const witness = v.object({ program, cost: v.number(), outcome: v.string() });
export const pedagogy = v.object({
  schemaVersion: v.literal(1), missionId: v.string(), missionRevision: v.number(), family,
  mathematicalObjective: v.string(), concepts: v.array(v.string()), rationale: v.string(),
  requestedConstraints: request, verification: v.union(v.literal("verified"), v.literal("degraded_fallback")),
  evidence: v.optional(v.object({
    schemaVersion: v.literal(1), family, minimumEnergy: v.number(), budget: v.number(), solution: program,
    alternative: v.optional(witness), checkpointBypass: v.optional(witness),
  })),
  limitations: v.array(v.string()),
});
export const proposal = v.object({ mission: missionContent, origin, calls: v.number(), repairs: v.number(), warning: v.optional(v.string()) });
export const reference = v.object({ missionId: v.id("aiMissions"), revisionId: v.id("aiMissionRevisions") });
