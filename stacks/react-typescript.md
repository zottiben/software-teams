---
stack: react-typescript
name: React 18 / TypeScript 5.8
domain: frontend
---

# React / TypeScript Conventions

## Expertise

React 18, TypeScript 5.8, MUI 7, React Router v7, TanStack React Query, react-hook-form + Zod, Vite 7, Turborepo, Bun, Vitest, ESLint/Prettier, WCAG.

## Conventions

- No `any` or `unknown` types — create proper interfaces
- Naming: `ComponentName.component.tsx`, `useHookName.ts`, `schemaName.schema.ts`
- Import order: external libs -> `@project` packages -> relative imports
- Always use `bun install --linker=hoisted`

## Focus Areas

### Architecture (Lead)

- Component hierarchies in shared UI library
- State: React Query (server), react-hook-form (forms), React context (UI). No Redux.
- Type safety via `bun run generate` -> `@project/types`
- Routes: React Router v7 with lazy loading, type-safe `@project/paths`

### Implementation (Senior)

- **Components**: MUI-based in `packages/ui/src/components/{Domain}/`
- **Hooks**: `packages/ui/src/hooks/`, exported via `index.ts`. Query hooks: `useGet*`, `useCreate*`, `useUpdate*`
- **Forms**: react-hook-form + `zodResolver`. Schemas in `packages/ui/src/schemas/`. Use `FieldWrapper`
- **Data fetching**: React Query + `clientApi` from `@project/client-api`. Keys: `['resource', id]`

### Verification

`bun run lint`, `bun run typecheck`, `bun run test:vitest`. Run `bun run generate` after DTO changes.

## Tooling Commands

| Purpose | Command |
|---------|---------|
| Lint | `bun run lint` |
| Type-check | `bun run typecheck` |
| Test | `bun run test:vitest` |
| Generate types | `bun run generate` |
| Build | `bun run build` |

## Contract Ownership — Tooling

- Run `bun run generate` for type alignment between backend DTOs and `@project/types`
- `@project/paths` for route safety — changes must preserve existing links
- `index.ts` barrel exports — no silent removal of public exports
- Zod schemas must match DTO / form shapes they guard

## Design System (from UX)

- **MUI 7**: Map designs to MUI components; custom components only when MUI has no equivalent
- **Theme tokens**: colour, spacing, typography, elevation, motion — all changes versioned
- **Shared library**: New components land in `packages/ui/src/components/{Domain}/`, never portal-local
- **Accessibility**: WCAG 2.1 AA — contrast (4.5:1 text, 3:1 large), keyboard nav, ARIA, focus indicators, screen reader support, respect `prefers-reduced-motion`

## DevOps

- **Bun**: Mandatory `--linker=hoisted`; fix module resolution by removing `node_modules` and reinstalling
- **Build**: Turborepo for monorepo orchestration, Vite dev server, `bun run build` for production
- **Containers**: Docker multi-stage builds for frontend assets
- **Monitoring**: Datadog RUM, error tracking
