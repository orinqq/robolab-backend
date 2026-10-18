import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireTeacher } from "./lib/access";
import { certifyAI } from "./lib/aiValidation";
import { reference } from "./lib/aiValidators";
import schema from "./schema";

async function own(ctx: QueryCtx, teacherId: Id<"users">, missionId: Id<"aiMissions">) {
  const mission = await ctx.db.get(missionId);
  if (!mission || mission.teacherId !== teacherId) throw new ConvexError("No encontramos esa misión.");
  return mission;
}
async function ownRevision(ctx: QueryCtx, teacherId: Id<"users">, missionId: Id<"aiMissions">, revisionId: Id<"aiMissionRevisions">) {
  const mission = await own(ctx, teacherId, missionId);
  const revision = await ctx.db.get(revisionId);
  if (!revision || revision.missionId !== missionId || revision.content.id !== missionId || revision.content.revision !== revision.number || revision.content.grade !== mission.generationGrade)
    throw new ConvexError("No encontramos esa revisión.");
  return { mission, revision };
}
async function latest(ctx: QueryCtx, mission: Doc<"aiMissions">) {
  const revision = await ctx.db.query("aiMissionRevisions").withIndex("by_missionId_and_number", q => q.eq("missionId", mission._id).eq("number", mission.latestRevision)).unique();
  if (!revision) throw new ConvexError("No encontramos esa revisión.");
  return revision;
}
function editable(revision: Doc<"aiMissionRevisions">, expected: number) {
  if (revision.status !== "draft") throw new ConvexError("La revisión publicada es inmutable. Crea otra revisión.");
  if (!Number.isSafeInteger(expected) || revision.editVersion !== expected) throw new ConvexError("La revisión cambió. Recarga antes de editar.");
}
export const createDraft = mutation({
  args: { runId: v.id("aiGenerationRuns"), grade: v.union(v.literal(2), v.literal(3), v.literal(4)) },
  returns: reference,
  handler: async (ctx, args) => {
    const teacherId = await requireTeacher(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.teacherId !== teacherId || run.status !== "completed") throw new ConvexError("No encontramos esa propuesta.");
    const proposal = run.proposals.find(p => p.mission.grade === args.grade);
    if (!proposal) throw new ConvexError("No encontramos ese grado en la propuesta.");
    const existing = await ctx.db.query("aiMissions").withIndex("by_teacherId_and_generationRunId_and_generationGrade", q => q.eq("teacherId", teacherId).eq("generationRunId", run._id).eq("generationGrade", args.grade)).unique();
    if (existing) return { missionId: existing._id, revisionId: (await latest(ctx, existing))._id };
    const now = Date.now();
    const missionId = await ctx.db.insert("aiMissions", {
      schemaVersion: 1, kind: "ai_custom", teacherId, generationRunId: run._id,
      generationGrade: args.grade, origin: proposal.origin, request: run.request,
      latestRevision: 1, availability: "not_available", createdAt: now, updatedAt: now,
    });
    const certified = certifyAI({ ...proposal.mission, id: missionId, revision: 1 }, run.request, proposal.origin === "template_fallback");
    const revisionId = await ctx.db.insert("aiMissionRevisions", {
      missionId, number: 1, status: "draft", ...certified, editVersion: 1, createdAt: now, updatedAt: now,
    });
    return { missionId, revisionId };
  },
});
export const updateDraft = mutation({
  args: { ...reference.fields, content: v.any(), expectedEditVersion: v.number() }, returns: v.number(),
  handler: async (ctx, args) => {
    const { mission, revision } = await ownRevision(ctx, await requireTeacher(ctx), args.missionId, args.revisionId);
    editable(revision, args.expectedEditVersion);
    const certified = certifyAI(args.content, mission.request);
    if (certified.content.id !== mission._id || certified.content.revision !== revision.number || certified.content.grade !== mission.generationGrade)
      throw new ConvexError("No puedes cambiar la identidad ni la revisión.");
    const now = Date.now();
    await ctx.db.patch(revision._id, { ...certified, editVersion: revision.editVersion + 1, updatedAt: now });
    await ctx.db.patch(mission._id, { updatedAt: now });
    return revision.editVersion + 1;
  },
});
export const publish = mutation({
  args: { ...reference.fields, expectedEditVersion: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const { mission, revision } = await ownRevision(ctx, await requireTeacher(ctx), args.missionId, args.revisionId);
    editable(revision, args.expectedEditVersion);
    const certified = certifyAI(revision.content, mission.request);
    const now = Date.now();
    await ctx.db.patch(revision._id, { ...certified, status: "published", publishedAt: now, updatedAt: now, editVersion: revision.editVersion + 1 });
    await ctx.db.patch(mission._id, { updatedAt: now });
    // Administrative publication only. No student resolver or assignment is created.
    return null;
  },
});
export const createRevision = mutation({
  args: reference.fields, returns: reference,
  handler: async (ctx, args) => {
    const { mission, revision } = await ownRevision(ctx, await requireTeacher(ctx), args.missionId, args.revisionId);
    if (revision.status !== "published" || revision.number !== mission.latestRevision)
      throw new ConvexError("Crea la revisión desde la última publicada; no puede haber otro borrador.");
    const number = revision.number + 1;
    const certified = certifyAI({ ...revision.content, revision: number }, mission.request);
    const now = Date.now();
    const revisionId = await ctx.db.insert("aiMissionRevisions", { missionId: mission._id, number, status: "draft", ...certified, editVersion: 1, createdAt: now, updatedAt: now });
    await ctx.db.patch(mission._id, { latestRevision: number, updatedAt: now });
    return { missionId: mission._id, revisionId };
  },
});
export const get = query({
  args: { missionId: v.id("aiMissions") }, returns: v.object({ mission: schema.doc("aiMissions"), revision: schema.doc("aiMissionRevisions") }),
  handler: async (ctx, args) => {
    const mission = await own(ctx, await requireTeacher(ctx), args.missionId);
    return { mission, revision: await latest(ctx, mission) };
  },
});
export const getRevision = query({
  args: reference.fields, returns: schema.doc("aiMissionRevisions"),
  handler: async (ctx, args) => (await ownRevision(ctx, await requireTeacher(ctx), args.missionId, args.revisionId)).revision,
});
export const listMine = query({
  args: { paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("aiMissions")),
  handler: async (ctx, args) => {
    const teacherId = await requireTeacher(ctx);
    return ctx.db.query("aiMissions").withIndex("by_teacherId", q => q.eq("teacherId", teacherId)).order("desc").paginate(args.paginationOpts);
  },
});
export const listRevisions = query({
  args: { missionId: v.id("aiMissions"), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc("aiMissionRevisions")),
  handler: async (ctx, args) => {
    await own(ctx, await requireTeacher(ctx), args.missionId);
    return ctx.db.query("aiMissionRevisions").withIndex("by_missionId_and_number", q => q.eq("missionId", args.missionId)).order("desc").paginate(args.paginationOpts);
  },
});
