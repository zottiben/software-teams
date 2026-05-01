/**
 * PhpLaravel stack component (Phase C migration).
 * Source: stacks/php-laravel.md
 */

import type { Component } from "../types";

const PhpLaravel: Component = {
  name: "PhpLaravel",
  category: "stacks",
  description: "PHP 8.4 / Laravel 11 stack doctrine",
  sections: {
    Default: {
      name: "Default",
      description: "PhpLaravel default body",
      body: `# PHP / Laravel Conventions

## Expertise

PHP 8.4, Laravel 11, MySQL, Eloquent ORM, Pest PHP, REST API, Spatie Laravel Data, Redis, Horizon, Passport/Sanctum, Pint, PHPStan, DDD.

## Conventions

- \`declare(strict_types=1)\` in every PHP file
- Elvis (\`?:\`) over null coalescing (\`??\`)
- \`updateOrCreate\` over \`firstOrCreate\` when data must persist
- Inline single-use variables; no unnecessary \`instanceof\` checks

## Focus Areas

### Architecture (Lead)

RESTful v2 endpoints (Controller -> Action -> DTO), multi-database architecture, Pint/PHPStan Level 5/Pest enforcement, auth middleware and Gates.

### Implementation (Senior)

- **Actions**: \`final readonly class\` in \`app/Actions/{Feature}/\`. Single \`__invoke\` with typed DTO.
- **DTOs**: Extend \`App Data\` with \`TypeScript\` attribute in \`app/Data/\`. Run \`bun run generate\` after changes.
- **FormRequests**: \`final class\` in \`app/Http/Requests/Api/\`. Use \`Rule::enum()\`, \`Rule::exists()\`.
- **Models**: \`app/Models/\` with relationships, casts, fillable. Use \`HasFactory\`, \`SoftDeletes\` where appropriate.
- **Migrations**: Proper types, indexes, foreign keys, nullable. Consider multi-database connections.

### Testing

Pest in \`tests/Feature/{Domain}/\`. Use \`TenantedTestCase\`, \`Passport::actingAs()\`. Cover: authorisation (403), happy path, validation, edge cases.

## Tooling Commands

| Purpose | Command |
|---------|---------|
| Lint / fix style | \`composer fix-style\` |
| Static analysis | \`composer stan\` |
| Test | \`composer test\` |
| Type export | \`bun run generate\` |

## Contract Ownership — Tooling

- Run \`bun run generate\` after DTO changes to export TypeScript types — backend and frontend types must not drift
- \`/v2/\` versioning convention for breaking changes; preserved routes keep their old contract
- FormRequest rules must match DTO properties
- Schema changes are additive by default; destructive changes (drop column, rename, type change) require explicit migration plan

## Verification

Run in order: \`composer fix-style\`, \`composer stan\`, \`composer test\`.

## DevOps

- **Queues**: Laravel Horizon supervisors — 1 process local, 10 production; prioritisation and failure handling
- **Redis**: Used for queues, cache, and session
- **Database**: MySQL ops, multi-database connections
- **Web server**: Nginx + PHP-FPM
- **Containers**: Docker multi-stage builds, PHP extensions management
- **Monitoring**: Datadog APM, error tracking, queue depth alerts`,
    },
  },
  defaultOrder: ["Default"],
};

export default PhpLaravel;
