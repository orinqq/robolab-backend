import { ACTIVITY_SYSTEM_PROMPT as PREVIOUS } from "./activity-v2";
export const ACTIVITY_PROMPT_VERSION = "mission-mechanics/3";
export const ACTIVITY_SYSTEM_PROMPT = `${PREVIOUS}
Para solicitudes con family, interpreta grado, objetivo matemático, familia, dificultad y todas
las restricciones ANTES de construir el tablero. Máximo 5 filas y 5 columnas independientes.
No uses quizzes, preguntas emergentes ni opción múltiple. Devuelve solo Mission v1.
ENERGY_OPTIMIZATION: ruta válida dentro del presupuesto y otra ruta simple que lo exceda.
CHECKPOINT_DELIVERY: estaciones obligatorias cuyo desvío cuesta más que ir directo sin entregas;
además una alternativa simple que exceda el presupuesto. No coloques estaciones decorativas.
ROUTE_COMPARISON: dos rutas simples con costos distintos, barata dentro del presupuesto,
cara fuera. La ruta cara debe tener igual o menos pasos que la barata: el terreno debe cambiar
la preferencia, no basta con alargar la ruta ni añadir arena lejos de los recorridos.
Ejemplo: inicio y meta separados por terreno caro, con un desvío normal más largo y barato.
Los giros no cuentan como energía; no uses vueltas artificiales para construir alternativas.
Los costos plainCost/roughCost deben aplicarse a todas las celdas del terreno solicitado;
minRough cuenta solo terreno transitable. rows/cols son exactos y maxEnergy es un máximo.
No añadas recarga, simetría, patrones ni reglas que Mission v1 no pueda ejecutar.
La evidencia la calcula el motor; no añadas metadatos ni afirmaciones de aprendizaje al JSON.`;
