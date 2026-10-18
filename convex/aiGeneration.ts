import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireTeacher } from "./lib/access";
import { parseAIRequest, certifyAI } from "./lib/aiValidation";
import { request, proposal } from "./lib/aiValidators";
import schema from "./schema";

/** Transactional leases: one per teacher, two globally. Expired runs cannot commit. */
export const begin = internalMutation({
  args: { request }, returns: v.id("aiGenerationRuns"),
  handler: async (ctx, args) => {
    const teacherId = await requireTeacher(ctx);
    const parsed = parseAIRequest(args.request);
    const now = Date.now();
    const own = await ctx.db.query("aiGenerationRuns")
      .withIndex("by_teacherId_and_status_and_leaseUntil", q => q.eq("teacherId", teacherId).eq("status", "running").gt("leaseUntil", now)).take(1);
    if (own.length) throw new ConvexError("Ya hay una generación en curso para tu cuenta.");
    const active = await ctx.db.query("aiGenerationRuns")
      .withIndex("by_status_and_leaseUntil", q => q.eq("status", "running").gt("leaseUntil", now)).take(2);
    if (active.length >= 2) throw new ConvexError("Hay dos generaciones en curso. Intenta más tarde.");
    return ctx.db.insert("aiGenerationRuns", { teacherId, request: parsed, status: "running", proposals: [], createdAt: now, leaseUntil: now + 120000 });
  },
});
export const finish = internalMutation({
  args: { runId: v.id("aiGenerationRuns"), proposals: v.array(proposal) }, returns: v.null(),
  handler: async (ctx, args) => {
    const teacherId = await requireTeacher(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.teacherId !== teacherId || run.status !== "running" || run.leaseUntil <= Date.now())
      throw new ConvexError("La generación venció. Vuelve a intentarlo.");
    if (args.proposals.length !== run.request.grades.length ||
        new Set(args.proposals.map(p => p.mission.grade)).size !== args.proposals.length)
      throw new ConvexError("El conjunto de propuestas no coincide con los grados.");
    for (const p of args.proposals) {
      if (!run.request.grades.includes(p.mission.grade) || !Number.isInteger(p.calls) || p.calls < 0 || p.calls > 3 ||
          p.repairs !== Math.max(0, p.calls - 1)) throw new ConvexError("Propuesta no válida.");
      certifyAI(p.mission, run.request, p.origin === "template_fallback");
    }
    await ctx.db.patch(run._id, { status: "completed", proposals: args.proposals, finishedAt: Date.now() });
    return null;
  },
});
export const fail = internalMutation({
  args: { runId: v.id("aiGenerationRuns") }, returns: v.null(),
  handler: async (ctx, args) => {
    const teacherId = await requireTeacher(ctx);
    const run = await ctx.db.get(args.runId);
    if (run?.teacherId === teacherId && run.status === "running")
      await ctx.db.patch(run._id, { status: "failed", finishedAt: Date.now() });
    return null;
  },
});
export const get = query({
  args: { runId: v.id("aiGenerationRuns") }, returns: schema.doc("aiGenerationRuns"),
  handler: async (ctx, args) => {
    const teacherId = await requireTeacher(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.teacherId !== teacherId) throw new ConvexError("No encontramos esa generación.");
    return run;
  },
});
