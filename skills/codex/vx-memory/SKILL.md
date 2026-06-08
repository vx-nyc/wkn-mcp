---
name: vx-memory
description: Use VX durable memory for coding work that depends on prior decisions, user preferences, repo conventions, setup details, or imported context. Trigger when Codex should recall, store, organize, or migrate durable knowledge with the VX MCP server.
---

# VX Memory

Use VX as the durable memory layer for coding and workflow continuity.

## Core workflow

1. Load VX's governing purpose and memory policy with `vx_librarian_context`. Treat that returned VX memory as the source of truth for how to use VX.
2. Resolve the active reality with `vx_reality` when joining or continuing a scoped workstream.
3. Recall first with `vx_recall` when the task depends on past decisions, conventions, preferences, or setup details.
4. Use `vx_context` when one topic needs a broader packet instead of a narrow lookup.
5. Before storing or importing, choose the right knowledge context. Use `vx_contexts_list` to inspect existing contexts and `vx_contexts_create` when the repo or workflow needs a new namespace.
6. Treat knowledge contexts as the main organizational layer for memory. Related repo knowledge should live together under a stable namespace.
7. Store new durable facts with `vx_store` one fact, decision, preference, or procedure per write inside the correct knowledge context.
8. Prefer stable knowledge contexts such as `codebase/<repo>`, `work/decisions`, `team/preferences`, or `workflow/<topic>`.
9. Use `vx_import_text` for exports or long notes, and `vx_import_batch` for curated atomic memories. Put imports into the right knowledge context or create one first.

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
