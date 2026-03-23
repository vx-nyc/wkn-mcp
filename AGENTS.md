# AGENTS.md - AI Agent Instructions for vx-mcp

Instructions for AI agents working on `vx-mcp`, the local SDK workspace, and related public client code.

## Public Repo Guardrails

This repository is public. Treat it as public at all times.

- Never mention private repositories, local private paths, or internal workspace structure.
- Never document or reference internal infrastructure, deployment details, environments, or operational topology.
- Never describe proprietary architecture, internal retrieval approaches, or implementation details that are not already intentionally public in this repository.
- Never include notes in commits, PR bodies, code comments, tests, or docs that mention patches made in a separate private repository.
- Keep guidance generic: refer to "a reachable VX API" or documented public endpoints, never to how internal services are started.

## Documentation Rules

- Document only the public SDK, MCP server, and public API usage exposed here.
- If a detail is not needed by an external user of this repo, leave it out.
- When in doubt, prefer less detail and describe the user-facing outcome instead of internals.

## PR Rules

- PR titles, descriptions, commit messages, and inline code comments must be safe to publish verbatim.
- Before opening or updating a PR, scan the diff for private repo names, local absolute paths, infrastructure references, and internal architecture language.
- If a change depends on private backend work, describe only the public behavior required by this repo. Do not mention where or how the backend change was made.
