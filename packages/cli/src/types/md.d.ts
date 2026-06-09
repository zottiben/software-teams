/** Ambient module declaration so tsc resolves *.md imports as string content.
 *  Bun loads .md files as text at runtime; this declaration satisfies the
 *  type-checker without changing runtime behaviour. */
declare module "*.md" {
  const content: string;
  export default content;
}
