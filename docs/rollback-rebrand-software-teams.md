# Rollback Playbook: JDI → Software Teams Rebrand

**Audience:** the maintainer team (NOT end users). This is the internal playbook for
reversing any of the four one-way distribution operations executed in plan
`2-01-rebrand-software-teams` (T15-T18). Keep this doc current whenever distribution
mechanics change.

> User-facing migration guide: [`migration-rebrand-software-teams.md`](./migration-rebrand-software-teams.md).

---

## When to roll back

Each of the four gates can be reversed (or partially reversed) if it goes wrong.
Trigger a rollback when:

- **T15 (repo rename) fails** — GitHub rename rejected (org settings), CI tokens
  invalidated, or external integrations break in a way you cannot fix in place.
- **T16 (npm publish) fails** — Package published with a critical bug, broken
  `dist/`, missing files, or an unpublishable typo (e.g. wrong `bin` path).
- **T17 (npm deprecate) fails** — Deprecation message is wrong, deprecation hits
  unintended versions, or you need to un-deprecate to restore in-flight installs.
- **T18 (plugin submission) fails** — Plugin submission is rejected, withdrawn, or
  the manifest needs a structural fix that a re-submission can carry.

Roll back early. The longer a broken state lives, the more downstream installs
inherit the breakage.

---

## Repo rename (T15)

### Symptom
You ran `gh repo rename` and one of the following:
- The org rejected the new name (`software-teams` collides with an existing repo).
- CI tokens stopped working (PAT scoped to old name).
- External integrations (Vercel, Sentry, monitoring) lost their webhooks.

### Reverse
GitHub repo renames are reversible by running the rename in the opposite direction.
The redirect flips back automatically.

```bash
gh repo rename jdi --repo zottiben/software-teams
```

Verify:
- `gh repo view zottiben/jdi` returns the repo info.
- `https://github.com/zottiben/software-teams` redirects to `/jdi`.
- CI runs resume on the next push.

After rollback, fix the root cause (rename collision, token scope, webhook URL),
then re-attempt T15.

---

## npm publish (T16)

### Symptom
You ran `npm publish` for `@benzotti/software-teams@<v>` and:
- The published tarball is broken (missing `dist/`, wrong `bin`, syntax error).
- `bunx @benzotti/software-teams` fails to start.
- The version number was wrong (e.g. you intended 0.2.0, published 0.1.58).

### Reverse — Option A: publish a fix (preferred)
npm strongly discourages unpublishing. The preferred path is to publish a patch.

```bash
# Fix the issue in source
git pull
# Bump version
npm version patch                          # or set explicitly in package.json
# Publish
npm publish --access public --provenance
```

Verify `npm view @benzotti/software-teams version` shows the new version, and
`bunx @benzotti/software-teams --version` resolves it.

### Reverse — Option B: unpublish (only within 72 hours)
If the broken version is unsafe to leave on the registry (security exposure,
credential leak), unpublish the specific version within npm's 72-hour window.

```bash
npm unpublish @benzotti/software-teams@<v>
```

Constraints:
- Allowed only within 72 hours of publish.
- After 72h, `npm unpublish` requires npm support intervention.
- Once unpublished, the same version number cannot be re-used for 24 hours.

After rollback, fix the issue, bump the version, publish a fresh release.

---

## npm deprecate (T17)

### Symptom
You ran `npm deprecate @benzotti/jdi "<msg>"` and:
- The message contains a typo or wrong link.
- You deprecated more versions than intended.
- A user reports the deprecation is causing CI failures (some pipelines fail-fast on
  deprecation warnings).

### Reverse
npm deprecate is reversible by passing an empty string. This removes the deprecation
flag from the registry metadata.

```bash
# Un-deprecate ALL versions
npm deprecate "@benzotti/jdi" ""

# Or un-deprecate a version range
npm deprecate "@benzotti/jdi@<=0.1.57" ""
```

Verify:
- `npm view @benzotti/jdi` no longer shows a `deprecated` field.
- A fresh `bunx @benzotti/jdi --version` no longer emits a deprecation warning
  (existing caches may take a few minutes to refresh).

After rollback, fix the message, then re-run T17 with the corrected text.

---

## Plugin submission (T18)

### Symptom
You submitted the plugin to Anthropic and:
- The submission was rejected (manifest, content, or licensing issue).
- You need to withdraw a submission already in review.
- Anthropic's review surfaces a structural fix that requires a manifest change.

### Reverse
Plugin submissions are submitted via Anthropic's process (form / contact / registry
PR — depends on what T18's research step found). Withdrawal also follows Anthropic's
process; there is no self-serve withdrawal API at the time of writing.

Steps:
1. Contact Anthropic via the same channel used to submit (form reply, email,
   or registry PR comment).
2. Request withdrawal or pause-for-revision.
3. Note the tracking ID / submission reference in `SUMMARY.md`.

The plugin remains installable via `--plugin-dir <repo-root>` regardless of submission
status — direct install is always available. Users can keep using the plugin while a
revised submission is in review.

After rollback, address the feedback, re-build the plugin (`software-teams build-plugin`),
re-run T12 validation, and resubmit.

---

## Full rollback (rename, publish, deprecate, plugin all reversed)

If the entire rebrand needs to be reversed (extreme case — coordinated incident,
brand-conflict legal, etc.), the order is:

1. **Un-deprecate the old npm package** (T17 reverse) — restores in-flight installs.
2. **Publish a "redirect" version of `@benzotti/jdi`** if needed — points users
   back at `@benzotti/jdi` from any `@benzotti/software-teams` installs already in
   the wild.
3. **Withdraw the plugin submission** (T18 reverse) — pauses any registry listing.
4. **Rename the repo back** (T15 reverse) — `gh repo rename jdi --repo
   zottiben/software-teams`.
5. **Coordinate the source-tree revert** — open a PR that reverts the rebrand commits
   and republishes under the old identity. This is a substantial code change and is
   out of scope for this doc — link it from the incident postmortem.

A full rollback is **not** expected. The four individual rollbacks above cover every
realistic failure mode.

---

## Verification after rollback

For each rollback path above, the team must confirm:

- [ ] The reversed operation is observable externally (registry, GitHub, plugin
      registry).
- [ ] CI on `main` is green.
- [ ] No user-visible breakage remains (smoke test: `bunx @benzotti/software-teams
      --version` if applicable, repo URL resolves, plugin install still works via
      `--plugin-dir`).
- [ ] The deviation is recorded in `.software-teams/state.yaml` deviation log AND
      in the plan's `SUMMARY.md` under "Rollback events".

If any of these are not green after rollback, escalate to head-engineering.
