# Contributing to bbb-siege

Thank you for your interest in contributing to `bbb-siege`!

## Architectural Principles

1. **Adapter Pattern**: All BigBlueButton internal protocol knowledge must be contained within `packages/protocol/src/adapters/`. Core orchestration, metrics, and CLI must only import from the `BbbAdapter` interface.
2. **TypeScript Strict ESM**: All packages use strict TypeScript settings and Node ESM modules.
3. **No Unapproved Dependencies**: Consult `AGENTS.md` before introducing external frameworks or libraries.
4. **Structured Logging**: Use `pino` for structured JSON logging. Never use `console.log`.
5. **Safety Guardrails**: Never point test runs at production servers without explicit `--i-understand` flags and host matching.

## Development Workflow

1. Ensure Node.js 22 LTS and pnpm are installed.
2. Clone the repository and install dependencies:
   ```bash
   pnpm install
   ```
3. Run builds, tests, and linter:
   ```bash
   pnpm build
   pnpm test
   pnpm lint
   pnpm typecheck
   ```
4. Follow Conventional Commits for commit messages.
