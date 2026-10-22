# AGENTS.md

These instructions apply to the entire repository.

## Mission

Build the application described in `Lastenheft_Fotobox-Verwaltung_MVP.md` incrementally. The project name is **AuftragsKompass**. It starts as a locally operated system for one Fotobox business and must remain structurally capable of serving other event and service businesses later.

The authoritative implementation sequence is `IMPLEMENTATION_PLAN.md`. The complete competitive research in `Bookitup_Funktionsinventar_vollstaendig.md` is reference material, not automatic scope.

The user’s 22 October 2026 direction is a comprehensive Bookitup functional and interaction clone with cautious simplification. Read [the parity specification](docs/bookitup-parity/README.md), its evidence limits and detailed tickets before related changes. It supersedes older MVP omissions for the target backlog, not the safety rules or one-slice workflow. Activate one concrete parity ticket in the implementation plan before coding; do not treat the whole backlog as one slice.

## Required reading before changes

1. Read this file completely.
2. Read the relevant part of `Lastenheft_Fotobox-Verwaltung_MVP.md`.
3. Read the current milestone and commit slice in `IMPLEMENTATION_PLAN.md`.
4. Inspect `git status`, recent commits, and existing tests before editing.

For a new session or handoff, also read [the project handoff](docs/handoff.md) before selecting work. It records user decisions, skill requirements and the last verified operating state. Treat dated status as a snapshot: verify the actual repository, CI and deployment before making changes.

If requirements conflict, the order of precedence is: latest explicit user instruction, `AGENTS.md`, the focused Lastenheft, the implementation plan, then the full research inventory.

## Scope and privacy boundary

This Git root also contains private customer and print-layout material that is intentionally excluded by the root allow-list in `.gitignore`.

- Never use `git add .`, `git add -A`, `git add -f`, or broaden `.gitignore` without explicit user approval.
- Stage only explicit application paths with `git add -- <paths>`.
- Before every commit, inspect `git diff --cached --name-status` and `git diff --cached`.
- Never commit customer names, email addresses, telephone numbers, event addresses, credentials, tokens, production exports, uploads, generated contracts, invoices, backups, or mailbox data.
- Fixtures must be synthetic and visibly fictional.
- Secrets belong outside the repository. Commit only documented `.env.example` keys with non-secret placeholder values.
- Logs and test snapshots must not contain personal data or OAuth/email credentials.

## Architecture guardrails

- Start as a modular monolith, not a network of business microservices.
- Use TypeScript for application code.
- Use React and Vite for the administrative UI and embeddable widget.
- Use Fastify for HTTP APIs and PostgreSQL as the source of truth.
- Use Drizzle for typed database access, supplemented by reviewed SQL migrations where PostgreSQL-specific constraints are required.
- Use a PostgreSQL-backed worker for background jobs so the local MVP does not require Redis.
- Keep the public gateway separated from the local administrative API.
- Public availability is a derived, anonymized projection. The local core remains authoritative for reservations.
- Put `tenant_id` on business-owned records from the beginning, even while the UI supports only one tenant.
- Put hard invariants in the database where possible. In particular, confirmed resource reservations must be protected against overlap by PostgreSQL constraints and transactions.
- Store money as integer minor units or exact `numeric`, never floating point.
- Store timestamps in UTC and preserve the tenant timezone for display and relative scheduling.
- Final invoices and signed contracts are immutable. Corrections create new records.
- External side effects must be idempotent and use an outbox/job mechanism.
- Storage access must go through an adapter supporting local files now and S3-compatible storage later.
- Public APIs and the WordPress widget protocol must be versioned.

## Commit-by-commit workflow

### User-requested skills

- Use **Ponytail**, default full, for coding, fixes and reviews: the smallest complete solution, without cutting validation, security, accessibility or required tests.
- Use **Impeccable** for frontend design, changes and reviews. Read its current `SKILL.md` and applicable workflow; preserve the existing design system and complete its required finish review/documentation.
- For interface polish and motion, use **emil-design-eng** and, when implementing animation, **animate** as appropriate. Respect keyboard use and reduced motion.
- Use **design-taste-frontend** for surfaces within its supported scope. Its current version excludes dashboards/app screens; do not force a new marketing direction onto the administration. Follow its component exception for narrow extensions where applicable.
- Use **REA** (`reverse-engineer-anything`) for the requested Bookitup/runtime comparison and further reference evidence. Read its installed skill and actual available tool schemas; distinguish browser/source observations from REA Evidence. Installation does not register MCP. Availability and known capture limitations are recorded in the parity specification.
- These are explicit user preferences carried forward from this project chat. Before first use in a session, locate and read the installed skill and announce its use. Skill names, local locations and previous review limitations are recorded in [the handoff](docs/handoff.md). If a required skill is unavailable, report that and resolve its availability rather than silently claiming to have used it. Do not claim that documentation alone installs a skill.

### Slice workflow

Work on exactly one numbered slice from `IMPLEMENTATION_PLAN.md` at a time.

1. Confirm the slice's scope and acceptance test.
2. Add or update a failing test that demonstrates the missing behavior.
3. Implement the smallest coherent change that passes the test.
4. Refactor only within the slice; do not pull future features forward.
5. Run the required quality gates.
6. Update documentation or the plan checkbox when behavior or setup changed.
7. Stage explicit paths only and review the staged diff.
8. Create one Conventional Commit using the subject from the plan unless the actual scope requires a more accurate equivalent.
9. Push the commit immediately to the configured GitHub remote.
10. Report the commit hash, pushed branch, tests run, and any remaining risk.

Do not combine adjacent slices merely because they are small. Do not split a database migration from the code and tests that require it unless the migration is a separately deployable, backward-compatible preparation step.

## Git and GitHub rules

- `main` must always be releasable and green.
- Use a `codex/<short-feature>` branch for implementation milestones unless the user explicitly asks for direct-to-main work.
- Push every completed commit; do not leave completed work only locally.
- Never force-push, rewrite, amend, or squash commits that were already pushed unless the user explicitly requests it.
- Preserve the individual implementation commits when merging a milestone.
- Never bypass failing tests to push a feature commit.
- If no remote exists, authentication fails, or GitHub rejects the push, stop after the local commit and report the exact blocker.
- Repository creation, visibility changes, branch protection, releases, and deletion are explicit external actions. Follow the user's selected name and visibility.

## Testing policy

Every behavior change ships with tests in the same commit.

### Test layers

- **Unit tests:** domain rules, calculations, state transitions, placeholder rendering, scheduling, and validation.
- **Database integration tests:** migrations, constraints, transactions, repositories, tenant isolation, and concurrency using a disposable PostgreSQL database.
- **API integration tests:** Fastify route validation, authorization, idempotency, error contracts, and persistence.
- **Component tests:** forms, tables, calendars, accessibility states, and error handling.
- **End-to-end tests:** critical workflows in real Chromium using synthetic data.
- **Contract tests:** public gateway synchronization, WordPress widget API, IMAP/SMTP adapters, ICS output, and storage adapters.
- **Snapshot/visual tests:** PDFs and the public widget, with stable fonts and deterministic dates.

### Coverage gates

- Domain and application services: at least 90% line coverage and 85% branch coverage.
- Repository-wide changed-code coverage: at least 85% lines and 80% branches.
- Critical rules require explicit branch tests rather than relying only on coverage numbers:
  - resource overlap and simultaneous booking attempts,
  - invoice and offer numbering,
  - monetary totals, discounts, tax, deposits, and corrections,
  - signed-contract immutability and document hashes,
  - tenant isolation and public-token authorization,
  - idempotent mail, gateway, and worker retries.

Coverage exclusions must be narrow, justified in code, and never cover business logic.

### Required gates before each commit

Run the applicable commands once they exist:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:component
pnpm test:e2e
pnpm build
```

During early slices, run every available command. Once the full suite exists, feature commits must run all fast gates plus affected integration/E2E tests. Milestone and release commits must run the entire suite.

## Database and migration rules

- Migrations are forward-only after they have been pushed.
- Never edit an already-pushed migration; add a corrective migration.
- A migration and its integration test belong in the same commit.
- Destructive migrations require a backup/restore note and explicit user approval.
- Seed data must be fictional. Production imports use separate ignored input files.
- Test rollback, restart, and concurrent behavior for reservation and numbering changes.

## Public forms, contracts, and files

- Treat all public input, filenames, HTML, email content, and imported data as untrusted.
- Validate request and response schemas server-side.
- Escape rendered content and sanitize any allowed rich text.
- Enforce upload type and size limits; scan uploads before making them available.
- Store public tokens hashed where feasible, with expiry, revocation, and rate limiting.
- Never expose internal IDs, customer data, event details, or exact bookings in the public availability projection.
- A public request creates at most a temporary hold; only the local core may confirm a resource booking.
- Signed document creation and resource confirmation must be atomic or fail safely.

## Definition of done for a slice

A slice is complete only when:

- its stated behavior and acceptance test pass,
- relevant negative and authorization cases are covered,
- migrations and API contracts are documented,
- no secret or personal data is staged,
- formatting, linting, types, tests, and build are green,
- the commit is focused and understandable on its own,
- the commit has been pushed to GitHub,
- `IMPLEMENTATION_PLAN.md` reflects the completed slice.
