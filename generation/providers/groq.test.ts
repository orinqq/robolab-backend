import { describe, expect, it, vi } from "vitest";
import { missionFixtures } from "../../domain/mission/fixtures";
import { GroqProvider, MAX_GROQ_RESPONSE_BYTES } from "./groq";
const input = () => ({
  systemPrompt: "Devuelve JSON seguro.",
  request: { objective: "Practicar sumas.", grade: 2 as const },
  previousIssues: [],
  signal: new AbortController().signal,
});
const response = (content: string, finish_reason = "stop") =>
  Response.json({ choices: [{ finish_reason, message: { content } }] });
describe("adaptador oficial Groq sin red", () => {
  it("envía JSON mode y datos en mensaje de usuario, nunca herramientas físicas", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(JSON.stringify(missionFixtures[0])));
    const provider = new GroqProvider(
      "clave-ficticia",
      "modelo-de-prueba",
      fetchImpl,
    );
    expect(await provider.propose(input())).toEqual(missionFixtures[0]);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(options!.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).not.toHaveProperty("tools");
    expect(body.messages[0].role).toBe("system");
    expect(options!.signal).toBeDefined();
  });
  it.each([401, 403, 429, 503, 404])(
    "normaliza error HTTP %i sin filtrar cuerpo o clave",
    async (status) => {
      const provider = new GroqProvider(
        "clave-ficticia",
        "modelo",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("dato-secreto-del-proveedor", { status }),
          ),
      );
      await expect(provider.propose(input())).rejects.toMatchObject({
        code:
          status === 401 || status === 403
            ? "PROVIDER_AUTH"
            : status === 429
              ? "PROVIDER_RATE_LIMIT"
              : "PROVIDER_UNAVAILABLE",
      });
    },
  );
  it.each([
    response("no es JSON"),
    response("{}", "length"),
    Response.json({}),
    new Response("cuerpo no JSON"),
  ])("rechaza respuesta no confiable %#", async (res) => {
    await expect(
      new GroqProvider(
        "test",
        "modelo",
        vi.fn<typeof fetch>().mockResolvedValue(res),
      ).propose(input()),
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });
  it("limita cuerpos incluso sin Content-Length", async () => {
    const res = new Response("x".repeat(MAX_GROQ_RESPONSE_BYTES + 1));
    await expect(
      new GroqProvider(
        "test",
        "modelo",
        vi.fn<typeof fetch>().mockResolvedValue(res),
      ).propose(input()),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
  });
  it("propaga cancelación real a fetch y no filtra errores de red", async () => {
    const controller = new AbortController();
    controller.abort();
    const p = new GroqProvider(
      "test",
      "modelo",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("error interno")),
    );
    await expect(
      p.propose({ ...input(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
});
