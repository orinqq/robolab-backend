import type { Heading, Cell as GamePosition } from "../game/map";
import type { Command as GameCommand } from "../game/program";

/** Formato JSON v1. Coordenadas cero-based: fila hacia abajo, columna a la derecha. */
export type Position = GamePosition;
export type Command = GameCommand;
export type Cell = {
  readonly position: Position;
  readonly terrain: "plain" | "rough";
  readonly obstacle: boolean;
  readonly cost: number;
};
export type Grid = {
  readonly rows: number;
  readonly cols: number;
  readonly cells: readonly Cell[];
};
export type Checkpoint = { readonly id: string; readonly position: Position };
export type Mission = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly objective: string;
  readonly grade: 2 | 3 | 4;
  readonly grid: Grid;
  readonly start: Position;
  readonly goal: Position;
  readonly initialHeading: Heading;
  readonly checkpoints: readonly Checkpoint[];
  readonly energyBudget: number;
  readonly allowedCommands: readonly Command[];
};
/** Secuencia ya expandida; el editor existente conserva su AST de bloques. */
export type Program = {
  readonly schemaVersion: 1;
  readonly commands: readonly Command[];
};
export type ValidationIssue = {
  readonly code: "SCHEMA_INVALID" | "UNSOLVABLE" | "SEARCH_LIMIT";
  readonly path: string;
  readonly message: string;
};
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
export type ExecutionState = {
  readonly position: Position;
  readonly heading: Heading;
  readonly energyUsed: number;
  readonly visitedCheckpoints: readonly string[];
};
export type ExecutionOutcome =
  | "SUCCESS"
  | "COLLISION"
  | "OUT_OF_BOUNDS"
  | "ENERGY_EXCEEDED"
  | "MISSING_CHECKPOINTS"
  | "INCOMPLETE";
export type ExecutionTrace = {
  readonly schemaVersion: 1;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly initial: ExecutionState;
  readonly steps: readonly {
    readonly index: number;
    readonly command: Command;
    readonly cost: number;
    readonly state: ExecutionState;
  }[];
  readonly final: ExecutionState;
  readonly energyUsed: number;
  readonly visitedCheckpoints: readonly string[];
  readonly outcome: ExecutionOutcome;
  readonly failedStep?: number;
  readonly attemptedPosition?: Position;
};
export type Attempt = {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly missionId: string;
  readonly missionRevision: number;
  readonly program: Program;
  readonly trace: ExecutionTrace;
  /** Milisegundos Unix aportados por el servidor, nunca por el alumno. */
  readonly startedAt: number;
  readonly finishedAt: number;
};
export type SolveResult =
  | {
      readonly status: "SOLVED";
      readonly program: Program;
      readonly cost: number;
      readonly exploredStates: number;
    }
  | {
      readonly status: "UNSOLVABLE" | "SEARCH_LIMIT";
      readonly exploredStates: number;
    };
