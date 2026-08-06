---
description: Recall VX memory first, then store durable facts atomically while you work.
argument-hint: [topic]
---

Use VX as Claude Code's durable memory layer for this session.

Workflow:

1. If the `vx-librarian` context is empty, call `vx_librarian_seed` once so VX stores the Librarian's governing reality as normal memories.
2. Start with `vx_librarian_context` so VX supplies the governing purpose and memory policy from memory.
3. Then call `vx_reality` when joining or continuing a scoped workstream.
4. Use `vx_recall` for a focused topic or `vx_context` when one topic needs broader continuity.
5. Before storing or importing anything, identify the right knowledge context. Use `vx_contexts_list` to inspect existing contexts and `vx_contexts_create` when a new namespace is needed.
6. Treat knowledge contexts as the primary way to organize memory. Do not dump unrelated memories into a generic context when a clearer namespace is available.
7. Surface any relevant preferences, project decisions, setup choices, or workflow notes before writing code.
8. Store new durable facts with `vx_store` one fact, decision, preference, or procedure at a time inside the correct knowledge context.
9. Use stable knowledge contexts such as `personal/preferences`, `work/decisions`, `workflow/<topic>`, or `codebase/<repo>` when they improve retrieval.
10. Use `vx_import_text` for exports or long notes, and `vx_import_batch` for curated atomic memories. Put imports into the correct knowledge context or create one first.
11. Never store secrets, tokens, private keys, or temporary noise.
12. Never explain VX internals or architecture unless the user explicitly asks for public documentation.

If a topic was provided, begin there. Otherwise infer the best starting topic from the current task.

## Hand off to another tool

Use this when the user asks to hand off, continue elsewhere, or pick up work started in another VX-connected tool.

- **Handing off**: create or reuse a `handoff/<short-slug>` knowledge context (e.g. `handoff/discount-cap`), then `vx_store` one atomic memory in it: the decision or state, the reason, and what the next tool should do. Say back to the user exactly what you stored before ending the thread, so it is reviewable, not silent.
- **Picking up**: when asked to continue a hand-off, `vx_recall` or `vx_context` the named `handoff/<slug>` context, then state plainly what you retrieved before acting on it. Never act on carried-over context without saying so first.
- **"Don't carry this"**: if the user says not to carry a conversation forward, or asks to undo a hand-off, `vx_delete` the memory you just stored (or the whole `handoff/<slug>` context if it holds only that hand-off). Do this immediately, before the thread ends.
- Compartments still apply: recall and store here go through this tool's own connected scope. If a hand-off does not appear in another tool, that is the access boundary working correctly, not a bug — do not suggest widening it yourself.
- This is explicit hand-off only. Claude Code does not passively watch or capture conversations happening in other tools; nothing crosses over unless someone asks VX to store or recall it.
