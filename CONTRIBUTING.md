# Contributing to vx-mcp

Thanks for contributing.

## Setup

```bash
npm install
npm run build
npm test
```

For local API-backed checks:

```bash
VX_API_BASE_URL=http://localhost:3000/v1 npm run test:e2e
VX_API_BASE_URL=http://localhost:3000/v1 npm run test:counterparty
```

## Project layout

```text
vx-mcp/
├── src/          # MCP server, runtime, installer, local SDK wrapper
├── sdk/          # local SDK workspace used during development/build
├── skills/       # bundled host guidance
├── test/         # unit and integration coverage
└── .github/      # CI and publish workflows
```

## Public repo safety

This repository is public.

- Do not mention private repository names or local private filesystem paths.
- Do not document internal infrastructure or deployment details.
- Do not mention patches made in separate private repositories.
- Keep PR titles, descriptions, comments, and docs safe to publish verbatim.

## Making changes

1. Keep changes minimal and user-facing where possible.
2. Add or update tests when behavior changes.
3. Run the relevant validation commands before opening a PR.
4. Update `CHANGELOG.md` for release-facing changes.
