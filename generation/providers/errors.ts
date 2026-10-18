import type { GenerationErrorCode } from "../contracts";
const MESSAGES: Partial<Record<GenerationErrorCode, string>> = {
  SCHEMA_INVALID: "La respuesta no contiene una misión JSON válida.",
  PROVIDER_TIMEOUT: "Groq no respondió dentro del tiempo permitido.",
  PROVIDER_AUTH:
    "La clave de Groq no autoriza esta solicitud. Revisa la configuración del servidor.",
  PROVIDER_RATE_LIMIT:
    "Groq alcanzó su límite de solicitudes. Intenta más tarde.",
  PROVIDER_UNAVAILABLE:
    "No pudimos conectar con Groq o el modelo no está disponible.",
  PROVIDER_RESPONSE_TOO_LARGE:
    "La respuesta del proveedor excedió el límite permitido.",
  PROVIDER_NOT_CONFIGURED:
    "Falta configurar Groq en el servidor. Puedes usar las plantillas.",
};
/** Nunca incluye cuerpo HTTP, claves ni mensajes crudos del proveedor. */
export class ProviderError extends Error {
  constructor(readonly code: GenerationErrorCode) {
    super(MESSAGES[code] ?? "No se pudo completar la generación.");
    this.name = "ProviderError";
  }
}
