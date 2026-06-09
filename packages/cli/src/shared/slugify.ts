/**
 * Communal URL-safe slug transform shared across the package boundary.
 *
 * Node-safe (no Bun APIs) so the n8n community-node package can consume it via
 * the `@websitelabs/software-teams` workspace dependency. The CLI's
 * Bun-coupled `utils/git.ts` and n8n's `output/github.ts` each keep their own
 * `maxLength` default (30 vs 50) and delegate the transform here — single
 * source of truth, no copy-paste of the slug logic across the boundary.
 */
export function slugify(input: string, maxLength: number): string {
  const slug = (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
  return slug || "task";
}
