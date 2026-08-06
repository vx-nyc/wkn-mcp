---
name: vx-memory
description: Use VX durable memory for coding work that depends on prior decisions, user preferences, repo conventions, setup details, or imported context. Trigger when Codex should recall, store, organize, or migrate durable knowledge with the VX MCP server.
---

# VX Memory

Use VX as the durable memory layer for coding and workflow continuity.

## Core workflow

1. If the `vx-librarian` context is empty, initialize it with `vx_librarian_seed`; this stores the Librarian's governing reality as normal VX memories instead of local prompt text.
2. Load VX's governing purpose and memory policy with `vx_librarian_context`. Treat that returned VX memory as the source of truth for how to use VX.
3. Resolve the active reality with `vx_reality` when joining or continuing a scoped workstream.
4. Recall first with `vx_recall` when the task depends on past decisions, conventions, preferences, or setup details.
5. Use `vx_context` when one topic needs a broader packet instead of a narrow lookup.
6. Before storing or importing, choose the right knowledge context. Use `vx_contexts_list` to inspect existing contexts and `vx_contexts_create` when the repo or workflow needs a new namespace.
7. Treat knowledge contexts as the main organizational layer for memory. Related repo knowledge should live together under a stable namespace.
8. Store new durable facts with `vx_store` one fact, decision, preference, or procedure per write inside the correct knowledge context.
9. Prefer stable knowledge contexts such as `codebase/<repo>`, `work/decisions`, `team/preferences`, or `workflow/<topic>`.
10. Use `vx_import_text` for exports or long notes, and `vx_import_batch` for curated atomic memories. Put imports into the right knowledge context or create one first.

## Store these

- Repo conventions that are not obvious from linting alone.
- Durable user preferences that should shape future implementation.
- Project decisions, setup choices, and debugging procedures worth reusing.
- Milestones or task state that future sessions may need.

## Avoid these

- Secrets, tokens, private keys, or credentials.
- One-off noise that will not matter after the current task.
- Large mixed-topic paragraphs when smaller atomic memories would retrieve better.
- Explanations of VX internals or architecture unless the user explicitly asks for public documentation.

## Query patterns

- Ask focused questions such as `release workflow`, `test runner`, `billing retry policy`, or `repo conventions`.
- Retry with a specific knowledge context when recall is too broad.
- Gather the needed facts first, then continue with the implementation.

## Hand off to another tool

Use this when the user asks to hand work off, continue elsewhere, or pick up a thread started in another VX-connected tool (Claude Code, Cursor, Hermes, OpenClaw, etc.).

- **Handing off**: create or reuse a `handoff/<short-slug>` knowledge context, then `vx_store` one atomic memory in it: the decision or state, the reason, and what the next tool should do. Report back exactly what was stored before ending the session — never a silent hand-off.
- **Picking up**: when continuing a hand-off, `vx_recall` or `vx_context` the named `handoff/<slug>` context, then state plainly what was retrieved before acting on it.
- **"Don't carry this"**: if the user says not to carry a conversation forward, `vx_delete` the memory just stored (or the `handoff/<slug>` context) immediately, before the session ends.
- Compartments still apply: recall and store go through this tool's own connected scope. A hand-off missing from another tool is the access boundary working as intended, not a defect.
- This is explicit only — Codex does not passively capture what happens in other tools; nothing carries over unless VX is asked to store or recall it.
