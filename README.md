# Enercore Workspace

A Next.js / TypeScript CRM foundation for Petronik, Afrilube, Petronex and Istanegry. Premium responsive workspace with a navy sidebar, teal accents, focused departmental views and employee self-service. This is a working first implementation, not the completed production ERP described in the original brief.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:8788/login. The default local launch builds the production
application and runs it in a **local Worker with local D1**, real credential
sessions, company/role permissions and a local LiveKit call server. It never
deploys or contacts production data. Local LiveKit must be installed.

Use `studio@collab.test` / `Collab-Test-Password-1` for the fictional management
workspace. Other fictional roles include `cmsales@collab.test`,
`cmsales2@collab.test` and `cmmd@collab.test`, using the same test password.
Never use these accounts/passwords in production.

Restart with `npm run dev` to reopen the same saved local database. Existing
fixture edits are not overwritten on resume. Use `npm run dev -- --fresh` for
a separate test database (previous data stays intact), or
`npm run dev -- --resume .wrangler/manual-review.NAME` for another saved review.
One workspace runs on port 8788 at a time; stop its existing server before launch.

`npm run dev:ui` starts the separate lightweight browser-only demo at
http://localhost:3000. It deliberately lacks server-backed workflows and is
**not** the full-feature testing environment. Do not change the preview guards
or connect production D1 to work around this distinction.

See [local testing coverage](docs/LOCAL-TESTING.md) for what is real locally,
what is a provider simulation and what still needs account setup. Local testing
does not mean every planned feature has already been implemented.

## Implemented

- Executive overview, company filter, contextual attention list and role-aware navigation.
- Sales board and list, quick lead entry, email/phone/destination, activity notes and next follow-up dates.
- Itemised quote form, line totals, manager approval, accepted quote to linked sales order, shipment and draft invoice.
- Logistics status tracking; customer, product, marketing, employee and IT record workspaces.
- Receipt references, partial payments, outstanding invoice balances and protection against duplicate payment references / overpayment.
- HR leave requests and independent employee self-service restricted to the signed-in user's own leave requests and IT tickets.
- MD/IT user provisioning, scoped roles and company access, deactivation with session revocation.
- Credential login, bcrypt hashing, opaque hashed sessions, account-based login throttling and origin checks on mutations.
- Company/branch/ownership authorization on server operations; optimistic concurrency; transactional workflow writes; audit events.
- Signed website intake endpoint with a five-minute replay window, trusted assignment and event-ID deduplication.
- MySQL Prisma schema and initial migration, explicit initial-admin bootstrap, install manifest and print-to-PDF record summaries.

## Production setup

Production uses Cloudflare Workers and D1, not a MySQL `DATABASE_URL`.
See `docs/DEPLOYMENT.md` and `wrangler.jsonc` for the current architecture.
Local testing is separate from a production release; it does not authorize
deployment, real provider delivery or production migrations. Keep credentials
out of source and browser storage.

```sh
npm run typecheck
npm test
npm run build
npx playwright test
```

Browser automation requires the corresponding Playwright browser installation. The initial local test attempt was blocked by a missing browser executable; see the separate manual browser verification in `docs/STATUS.md`.

## Structure

- `src/lib/domain.ts`: domain types and permission policies.
- `src/lib/workflow.ts`: approval, conversion, notes and payment business rules.
- `src/app/api`: authenticated record/user APIs, self-service and signed website intake.
- `src/components`: workspace, record forms, user administration and self-service.
- `prisma`: initial database schema and migration; migrations are not applied automatically.
- `tests`: workflow and authorization tests using fictional records.
- `docs/STATUS.md`: full remaining implementation scope and verification limits.

## Important current limitations

The record envelope uses a validated JSON payload with indexed company, branch, kind, owner and status fields. It is suitable for this initial workflow implementation; full accounting and inventory require dedicated relational ledgers and constraints before operational use. Company and branch master management, field-level grants, MFA, password recovery, secure document storage, quote tax/discount/Incoterm calculations, actual accounting integrations and scheduled external notifications remain to be implemented. The browser print summary is not yet a jurisdiction-specific tax invoice.

The company spelling `Istanegry` preserves the supplied brief; confirm its legal name and website before publishing branded documents. Monetary dashboards currently aggregate USD records only; they are not consolidated financial statements or realised revenue.
