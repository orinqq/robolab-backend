"use node";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { parseAIRequest, certifyAI } from "./lib/aiValidation";
import { deploymentEnv } from "./lib/env";
import { generateActivity } from "../generation/orchestrator";
import { GroqProvider, DEFAULT_GROQ_MODEL } from "../generation/providers/groq";

export const generate = action({
  args: { request: v.any() }, returns: v.id("aiGenerationRuns"),
  handler: async (ctx, args): Promise<Id<"aiGenerationRuns">> => {
    const request = parseAIRequest(args.request);
    // begin authenticates through the existing teacher guard before any provider work.
    const runId: Id<"aiGenerationRuns"> = await ctx.runMutation(internal.aiGeneration.begin, { request });
    try {
      const env = deploymentEnv();
      const model = env.LLM_MODEL?.trim() || DEFAULT_GROQ_MODEL;
      if (model.length > 100 || !/^[a-zA-Z0-9_./-]+$/.test(model))
        throw new ConvexError("Revisa LLM_MODEL en el servidor.");
      const provider = new GroqProvider(!env.LLM_PROVIDER || env.LLM_PROVIDER === "groq" ? env.GROQ_API_KEY ?? "" : "", model);
      const timeout = Number(env.LLM_TIMEOUT_MS ?? 15000);
      const result = await generateActivity(request, provider, {
        totalMs: 90000, timeoutMs: Number.isFinite(timeout) ? Math.max(1000, Math.min(20000, timeout)) : 15000,
      });
      const proposals = result.map(p => ({
        mission: certifyAI(p.mission, request, p.origin === "template_fallback").content,
        origin: p.origin, calls: p.calls, repairs: p.repairs,
        ...(p.warning ? { warning: p.warning } : {}),
      }));
      await ctx.runMutation(internal.aiGeneration.finish, { runId, proposals });
      return runId;
    } catch {
      await ctx.runMutation(internal.aiGeneration.fail, { runId });
      throw new ConvexError("No pudimos completar la generación. Intenta de nuevo.");
    }
  },
});
