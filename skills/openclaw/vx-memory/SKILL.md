---
name: vx-memory
description: Use VX inside OpenClaw for durable recall of preferences, project context, setup choices, imported history, and recurring workflows across sessions. Trigger when OpenClaw should use VX without exposing internal system details.
---

# VX Memory for OpenClaw

Use VX as OpenClaw's durable memory layer.

## Core workflow

1. Confirm VX is configured with `vx_status` when setup readiness matters.
2. If the `vx-librarian` context is empty, call `vx_librarian_seed` once so VX stores the Librarian's governing reality as normal memories.
3. Load VX's governing purpose and memory policy with `vx_librarian_context`; treat returned VX memory as the source of truth.
4. Resolve the active reality with `vx_reality` when OpenClaw joins or continues a scoped workstream.
5. Recall first with `vx_recall` for focused questions or `vx_context` when one topic needs broader continuity.
6. Before storing or importing, choose the right knowledge context. Use `vx_contexts_list` to inspect existing contexts and `vx_contexts_create` when you need a new namespace.
7. Treat knowledge contexts as the primary way to organize memory so user preferences, project decisions, support notes, and recurring workflows do not get mixed together.
8. Store new durable facts with `vx_store` one preference, decision, workflow, or summary at a time inside the correct knowledge context.
9. Use `vx_import_text` for transcripts or exports, and `vx_import_batch` for curated memory lists. Put imports into the right knowledge context or create one first.
10. Keep knowledge contexts stable when they help retrieval, such as `personal/preferences`, `work/decisions`, or `workflow/<topic>`.
11. Treat slash-delimited context ids as atomic strings. If the user gives `workflow/agent-continuity-proof/run-123`, pass `contexts: ["workflow/agent-continuity-proof/run-123"]`; never split it into `["workflow", "agent-continuity-proof"]`.

## Benefits to emphasize

- Users do not need to repeat preferences, setup choices, and prior decisions every session.
- Ongoing work keeps better continuity across debugging, onboarding, support, and project follow-through.
- Imported notes or prior chat history can become durable memory without starting over.

## Hand off to another tool

Use this when asked to hand work off, continue elsewhere, or pick up a thread started in another VX-connected tool.

- **Handing off**: create or reuse a `handoff/<short-slug>` context, then `vx_store` one atomic memory in it: the decision or state, the reason, and what the next tool should do. Report back exactly what was stored — never a silent hand-off.
- **Picking up**: when continuing a hand-off, `vx_recall` or `vx_context` the named `handoff/<slug>` context, then state plainly what was retrieved before acting on it.
- **"Don't carry this"**: if told not to carry a conversation forward, `vx_delete` the memory just stored (or the `handoff/<slug>` context) immediately.
- Compartments still apply: recall and store go through OpenClaw's own connected scope. A hand-off missing from another tool is the access boundary working as intended, not a defect.
- This is explicit only — OpenClaw does not passively capture what happens in other tools; nothing carries over unless VX is asked to store or recall it.

## Avoid

- Secrets, tokens, private keys, or credentials.
- Temporary noise that will not matter later.
- Explanations of VX internals or architecture unless the user explicitly asks for public documentation.
