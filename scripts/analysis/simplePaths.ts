/** Herramienta de auditoría offline. No importar desde código productivo. */
import type { Command, Mission, Position, Program } from "../../domain/mission/contracts";

export type SimplePath = { cells: number[]; energy: number; moves: number };
export function enumerateSimplePaths(m: Mission, maxStates = 5000000, maxMs = 15000) {
  const started = Date.now();
  const key = (p: Position) => p.row * m.grid.cols + p.col;
  const cells = new Map(m.grid.cells.map(c => [key(c.position), c]));
  const start = key(m.start), goal = key(m.goal);
  const required = m.checkpoints.map(c => key(c.position));
  const paths: SimplePath[] = [];
  let states = 0;
  let truncated = false;
  const path = [start];
  function visit(at: number, visited: number, energy: number) {
    if (truncated) return;
    if (++states > maxStates || (states % 1024 === 0 && Date.now() - started > maxMs)) { truncated = true; return; }
    if (at === goal) {
      if (required.every(c => (visited & (1 << c)) !== 0)) paths.push({ cells: [...path], energy, moves: path.length - 1 });
      return;
    }
    const row = Math.floor(at / m.grid.cols), col = at % m.grid.cols;
    for (const [dr, dc] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
      const r = row + dr!, c = col + dc!;
      if (r < 0 || c < 0 || r >= m.grid.rows || c >= m.grid.cols) continue;
      const next = r * m.grid.cols + c;
      const cell = cells.get(next)!;
      if (cell.obstacle || (visited & (1 << next)) !== 0) continue;
      path.push(next);
      visit(next, visited | (1 << next), energy + cell.cost);
      path.pop();
    }
  }
  if (m.grid.rows * m.grid.cols > 25) throw new Error("Herramienta limitada a 25 celdas.");
  visit(start, 1 << start, 0);
  return { paths, states, truncated, durationMs: Date.now() - started, maxStates, maxMs };
}

/** Compilación independiente: evita depender del solver para construir el testigo. */
export function pathProgram(m: Mission, path: SimplePath): Program {
  let heading: number = m.initialHeading;
  const commands: Command[] = [];
  for (let i = 1; i < path.cells.length; i++) {
    const a = path.cells[i - 1]!, b = path.cells[i]!;
    const dr = Math.floor(b / m.grid.cols) - Math.floor(a / m.grid.cols);
    const dc = b % m.grid.cols - a % m.grid.cols;
    const target = dr === -1 ? 0 : dc === 1 ? 90 : dr === 1 ? 180 : 270;
    const difference = (target - heading + 360) % 360;
    if (difference === 180) commands.push("BACKWARD");
    else {
      if (difference === 90) commands.push("TURN_RIGHT");
      if (difference === 270) commands.push("TURN_LEFT");
      heading = target;
      commands.push("FORWARD");
    }
  }
  if (commands.some(c => !m.allowedCommands.includes(c)) || commands.length > 128) throw new Error("Programa fuera de paleta/límite.");
  return { schemaVersion: 1, commands };
}
