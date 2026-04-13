# Stack Convention Files

Convention files contain technology-specific knowledge that agents load at runtime based on `PROJECT.yaml`'s `tech_stack` field.

## How It Works

- Each file defines expertise, conventions, focus areas, tooling, and contract checks for one stack
- Agents load the relevant file into context, replacing hardcoded technology sections
- One file per stack combination (e.g. `php-laravel.md`), not per individual technology

## Creating a New Convention File

1. Copy `_template.md` to `{stack-identifier}.md`
2. Fill in the frontmatter (`stack`, `name`, `domain`)
3. Populate each section with stack-specific content
4. Keep the file under 150 lines — every line must earn its place in the agent's context window

## Loading

Agents resolve convention files via `.jdi/framework/stacks/{tech_stack}.md` where `tech_stack` matches `PROJECT.yaml`. If no file exists, agents use their base spec only.

## Files

- `_template.md` — reference template
- `php-laravel.md` — PHP 8.4 / Laravel 11
- `react-typescript.md` — React 18 / TypeScript 5.8
