# The Daily Dough — working notes

## Stack

- **Frontend:** Angular 21.2 (standalone components, signals). No `.scss`
  anywhere in `src/` — styles are plain `.css`.
- **Backend:** Express under `server/`, written as plain CommonJS (`.cjs`),
  not TypeScript.
- **Data:** Supabase (Postgres). Schema lives in one file,
  `supabase_schema.sql`, re-run by hand — there is no migration runner. New
  columns are added as idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **Convention to know before touching recipe/ingredient code:** all weights
  are **grams**, everywhere, by convention — `logic/units.ts` is the one
  place unit conversion happens, and `logic/bakers-math.ts` must never import
  it (the storefront and server both re-run `calculateBakersMath` on raw
  grams data and must never need to know a unit picker exists).

**Commands:** `npm run dev` (client + server) · `npm test` (vitest) ·
`npm run lint` · `npm run e2e` (Playwright) · `npm run build`.

**Further reading:** `TECHNICAL_GUIDE.md` (architecture), `FEATURES.md`
(what's shipped vs. planned), `TESTING_GUIDE.md`. This file doesn't restate
those — check there first for anything architectural.

## Angular version note

This repo is on `@angular/core` 21.2.8. The global Angular rules in
`~/.claude/CLAUDE.md` are tiered by version — for this repo, everything up
through the **21.2 tier** applies (nothing above 22).

## Skills available in this repo

Skills are auto-discovered by Claude Code (they're listed with descriptions
every session) — this table isn't what makes them available, it's a guide to
which ones are actually relevant here.

**Apply to work in this repo:**

| Skill | Use it for |
|---|---|
| `angular-modern` | Writing/reviewing/modernizing any Angular component, service, or directive — `inject()`, signals/`computed()`, `OnPush`, subscription teardown, signal-based inputs/queries. Also `/angular-modern audit <path>` and `/angular-modern refresh`. |
| `explicit-types` | Any frontend TypeScript work — no `any`, no inferred param/return types, a named interface at every API/component boundary. |
| `document-feature` | Writing or updating docs for a feature just built, matching this repo's existing docs (`TECHNICAL_GUIDE.md`/`FEATURES.md`/`TESTING_GUIDE.md`) rather than inventing a new format. |

**Verisk PR/ticket workflow skills — not applicable here.** This is a
personal project on `main` with no PR review process, Jira board, or Teams
channel, so these don't have a use in this repo. Listed for completeness:

| Skill | What it does elsewhere |
|---|---|
| `pr-status` | Every open PR across your repos, what's blocking each, next action. |
| `check-pr-build` | Checks whether a PR's CI pipeline passed; diagnoses failures. |
| `check-pr-posted` | Which open PRs you've already announced in a Teams channel. |
| `notify-pr-reviewers` | Drafts a nudge for PRs that are genuinely ready for another look. |
| `post-pr-review-comments` | Posts review findings as inline PR comments. |
| `post-qa-test-guide` | Builds a "how to test this" guide, posts it to the linked Jira ticket. |
| `daily-recap` | What you worked on today (git + Jira) plus PR status. |
| `sprint-recap` | What you worked on over a sprint/date range, with demo suggestions. |
