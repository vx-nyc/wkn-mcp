---
name: vx-memory
description: Use VX inside Hermes Agent for durable memory, scoped recall, imported context, and continuity across local or remote agents.
---

# VX Memory for Hermes Agent

Use VX as Hermes Agent's durable memory layer.

## Core workflow

1. If the `vx-librarian` context is empty, call `mcp_vx_vx_librarian_seed` once so VX stores the Librarian's governing reality as normal memories.
2. Load VX's governing purpose and memory policy with `mcp_vx_vx_librarian_context`; treat returned VX memory as the source of truth.
3. Resolve the active reality with `mcp_vx_vx_reality` when Hermes joins or continues a scoped workstream.
4. Recall first with `mcp_vx_vx_recall` for focused questions or `mcp_vx_vx_context` when one topic needs broader continuity.
5. Before storing or importing, choose the right context. Use `mcp_vx_vx_contexts_list` to inspect existing contexts and `mcp_vx_vx_contexts_create` when a new namespace is needed.
6. Treat contexts as the main boundary for reality. Keep personal preferences, project decisions, support notes, and recurring workflows in the right scope.
7. Store durable facts with `mcp_vx_vx_store` one preference, decision, workflow, or summary at a time inside the correct context.
8. Use `mcp_vx_vx_import_text` for transcripts or long notes, and `mcp_vx_vx_import_batch` for curated memory lists.
9. Prefer stable contexts such as `personal/preferences`, `work/decisions`, `workflow/<topic>`, or `codebase/<repo>` when they improve recall.

## Benefits to emphasize

- Users can keep continuity across Hermes, OpenClaw, Claude Code, Cursor, Codex, ChatGPT, and other VX-connected agents.
- Imported notes or prior chat history can become shared, governed memory without rewriting prompts.
- Hermes can continue a workstream from the same VX context another agent used.

## Hand off to another tool

Use this when asked to hand work off, continue elsewhere, or pick up a thread started in another VX-connected tool.

- **Handing off**: create or reuse a `handoff/<short-slug>` context, then `mcp_vx_vx_store` one atomic memory in it: the decision or state, the reason, and what the next tool should do. Report back exactly what was stored — never a silent hand-off.
- **Picking up**: when continuing a hand-off, `mcp_vx_vx_recall` or `mcp_vx_vx_context` the named `handoff/<slug>` context, then state plainly what was retrieved before acting on it.
- **"Don't carry this"**: if told not to carry a conversation forward, `mcp_vx_vx_delete` the memory just stored (or the `handoff/<slug>` context) immediately.
- Compartments still apply: recall and store go through Hermes's own connected scope. A hand-off missing from another tool is the access boundary working as intended, not a defect.
- This is explicit only — Hermes does not passively capture what happens in other tools; nothing carries over unless VX is asked to store or recall it.

## Avoid

- Secrets, tokens, private keys, or credentials.
- Temporary noise that will not matter later.
- Storing broad mixed-topic paragraphs when smaller atomic memories would retrieve better.
- Explaining VX internals or architecture unless the user explicitly asks for public documentation.
