import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { enumerateSimplePaths, pathProgram, type SimplePath } from "./simplePaths";
import { parseMission, positionKey } from "../../domain/mission/validation";
import { executeMission, solveMission } from "../../domain/mission/engine";
import { validateMechanic, type MissionFamily } from "../../domain/mission/mechanics";
import { constraintIssues } from "../../generation/orchestrator";
import { parseActivityRequest } from "../../generation/request";
import type { Mission, ValidationIssue } from "../../domain/mission/contracts";

it("contrasta las tres propuestas reales con enumeración completa y replay", () => {
  const source = "node_modules/.cache/robolab-groq-evaluation/results.json";
  const bytes = readFileSync(source);
  const input = JSON.parse(bytes.toString()) as { results: { id: string; request: unknown; attempts: { validation?: { ok: boolean; value?: unknown }; constraints?: ValidationIssue[]; previousIssues: ValidationIssue[] }[] }[] };
  const reports = [];
  for (const result of input.results) for (const [index, attempt] of result.attempts.entries()) {
    if (!attempt.validation?.ok) continue;
    const mission = parseMission(attempt.validation.value);
    const request = parseActivityRequest(result.request);
    const family = request.family as MissionFamily;
    const solution = solveMission(mission);
    expect(solution.status).toBe("SOLVED");
    if (solution.status !== "SOLVED") throw new Error("No hay solución certificada.");
    const optimalTrace = executeMission(mission, solution.program);
    const optimalPositions = [mission.start, ...optimalTrace.steps.filter(s => s.cost > 0).map(s => s.state.position)];
    const optimalMoves = optimalPositions.length - 1;
    const enumeration = enumerateSimplePaths(mission);
    expect(enumeration.truncated).toBe(false);
    const { paths, ...limits } = enumeration;
    expect(paths.length).toBeGreaterThan(0);
    expect(Math.min(...paths.map(p => p.energy))).toBe(solution.cost);
    const replay = (path: SimplePath | undefined) => {
      if (!path) return null;
      const program = pathProgram(mission, path);
      const original = executeMission(mission, program);
      const relaxed = executeMission({ ...mission, energyBudget: 10000 }, program);
      const uniform = executeMission({ ...mission, energyBudget: 10000, grid: { ...mission.grid, cells: mission.grid.cells.map(c => ({ ...c, cost: 1 })) } }, program);
      expect(relaxed.outcome).toBe("SUCCESS");
      expect(relaxed.energyUsed).toBe(path.energy);
      expect(uniform.energyUsed).toBe(path.moves);
      expect(relaxed.visitedCheckpoints.length).toBe(mission.checkpoints.length);
      expect(original.outcome).toBe(path.energy > mission.energyBudget ? "ENERGY_EXCEEDED" : "SUCCESS");
      return { ...path, program, original, relaxed, uniform };
    };
    const expensive = paths.filter(p => p.energy > mission.energyBudget).sort((a, b) => a.energy - b.energy || a.moves - b.moves);
    const optimalRelevant = expensive.filter(p => p.moves <= optimalMoves);
    const byLength = new Map<number, SimplePath>();
    for (const p of paths.filter(p => p.energy <= mission.energyBudget)) {
      const prior = byLength.get(p.moves);
      if (!prior || p.energy < prior.energy) byLength.set(p.moves, p);
    }
    let equalPair: { cheap: SimplePath; expensive: SimplePath } | undefined;
    let strictPair: typeof equalPair;
    for (const e of expensive) {
      for (const [length, cheap] of byLength) {
        if (e.moves === length && !equalPair) equalPair = { cheap, expensive: e };
        if (e.moves < length && !strictPair) strictPair = { cheap, expensive: e };
      }
    }
    const probes = [...new Set(optimalPositions.map(positionKey))].filter(k => k !== positionKey(mission.start) && k !== positionKey(mission.goal) && !mission.checkpoints.some(c => positionKey(c.position) === k)).map(k => {
      const counterfactual: Mission = { ...mission, energyBudget: 10000, grid: { ...mission.grid, cells: mission.grid.cells.map(c => positionKey(c.position) === k ? { ...c, obstacle: true } : c) } };
      const alternative = solveMission(counterfactual);
      if (alternative.status !== "SOLVED") return { blocked: k, alternative };
      const trace = executeMission({ ...mission, energyBudget: 10000 }, alternative.program);
      const positions = [mission.start, ...trace.steps.filter(s => s.cost > 0).map(s => s.state.position)];
      return { blocked: k, status: alternative.status, energy: trace.energyUsed, moves: positions.length - 1, simple: new Set(positions.map(positionKey)).size === positions.length, outcome: trace.outcome };
    });
    const witnesses = {
      minimumSimple: replay(paths.reduce((a, b) => b.energy < a.energy ? b : a)),
      maximumSimple: replay(paths.reduce((a, b) => b.energy > a.energy ? b : a)),
      expensive: replay(expensive[0]), optimalRelevant: replay(optimalRelevant[0]),
      equalPair: equalPair ? { cheap: replay(equalPair.cheap), expensive: replay(equalPair.expensive) } : null,
      strictPair: strictPair ? { cheap: replay(strictPair.cheap), expensive: replay(strictPair.expensive) } : null,
    };
    const report = {
      id: `${result.id}${index + 1}`, request, mission, feedback: attempt.constraints, previousIssues: attempt.previousIssues,
      missionSha256: createHash("sha256").update(JSON.stringify(mission)).digest("hex"),
      solution, optimalTrace, optimalPositions, optimalMoves,
      optimalSimple: new Set(optimalPositions.map(positionKey)).size === optimalPositions.length,
      constraints: constraintIssues(mission, request, mission.grade), mechanic: validateMechanic(mission, family),
      limits, pathCount: paths.length, minEnergy: Math.min(...paths.map(p => p.energy)), maxEnergy: Math.max(...paths.map(p => p.energy)),
      expensiveCount: expensive.length, optimalRelevantCount: optimalRelevant.length,
      minMoves: Math.min(...paths.map(p => p.moves)), maxMoves: Math.max(...paths.map(p => p.moves)),
      witnesses, probes,
    };
    reports.push(report);
    console.info(JSON.stringify({ id: report.id, limits, pathCount: report.pathCount, minEnergy: report.minEnergy, maxEnergy: report.maxEnergy, optimalMoves, optimalSimple: report.optimalSimple, expensiveCount: expensive.length, optimalRelevant: optimalRelevant.length, equalPair: !!equalPair, strictPair: !!strictPair, probes }));
  }
  expect(reports).toHaveLength(3);
  expect(reports[0]!.missionSha256).toBe(reports[1]!.missionSha256);
  for (const r of reports.slice(0, 2)) {
    expect(r.pathCount).toBe(156);
    expect(r.expensiveCount).toBe(104);
    expect(r.minEnergy).toBe(11);
    expect(r.witnesses.expensive?.energy).toBe(19);
    // Tras la corrección productiva, el oráculo independiente conserva su evidencia
    // y exige que A deje de ser un falso negativo. No altera artefactos históricos.
    expect(r.mechanic.ok).toBe(true);
  }
  expect(reports[2]!.pathCount).toBe(1512);
  expect(reports[2]!.optimalRelevantCount).toBe(0);
  expect(reports[2]!.witnesses.equalPair).not.toBeNull();
  expect(reports[2]!.witnesses.strictPair).not.toBeNull();
  expect(enumerateSimplePaths(reports[0]!.mission, 1).truncated).toBe(true);
  const artifact = { source, sourceSha256: createHash("sha256").update(bytes).digest("hex"), generatedAt: new Date().toISOString(), reports };
  // Ruta nueva: jamás sobrescribe los artefactos de generación o diagnósticos previos.
  writeFileSync(`node_modules/.cache/robolab-groq-evaluation/diagnosis-${Date.now()}.json`, JSON.stringify(artifact, null, 2), { flag: "wx", mode: 0o600 });
}, 60000);
