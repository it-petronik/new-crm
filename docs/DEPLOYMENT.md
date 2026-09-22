# Hosting and database deployment

No live deployment, database write or migration has been performed. A cPanel hosting plan has not been inspected. Storage space alone does not establish that it supports running Next.js.

## Hosting requirements

- A supported Node.js runtime compatible with the pinned Next.js release, persistent Node process and HTTPS reverse proxy.
- MySQL/MariaDB supported by Prisma 6.19.3, utf8mb4, transactions and JSON support.
- A private database user limited to this CRM database. Use a separate migration account and restrict the runtime account from schema changes. Prefer restricting audit tables to insert/read for runtime use.
- If the application and database use different hosts, allow only the application host IP and use TLS. Never expose a database port to all IPs.
- Scheduled jobs, encrypted independent backups, logs and resource monitoring.

Confirm the cPanel plan's Node application manager, Node version, remote database policy, TLS, memory/process limits and backup/restore access with the hosting provider. If it cannot reliably run Next.js, use a VPS for the app and retain cPanel MySQL only if a secure connection is supported. A static HTML upload does not run this application.

## Approved staging setup

1. Create an isolated empty database and configure the private `DATABASE_URL`.
2. Set `APP_MODE=production`, `APP_URL=https://your-approved-staging-host`, `NODE_ENV=production`.
3. Install from the lockfile with `npm ci`; generate the Prisma client with `npm run db:generate`.
4. Review `prisma/migrations/202609220001_initial/migration.sql`. Only after database approval, apply with `npm run db:migrate`.
5. Create the initial MD administrator through `npm run db:bootstrap`, using private environment variables `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` (minimum 14 characters) and `BOOTSTRAP_CONFIRM=CREATE_INITIAL_ADMIN`. The command refuses to run if users already exist. Remove bootstrap secrets after use.
6. Build using `npm run build`. Run `npm start` under a process manager or the provider's Node application system, behind HTTPS. For the generated standalone build, follow Next.js standalone asset-copy requirements or use the ordinary start command with installed dependencies.
7. Verify login, deactivation, branch isolation, company isolation, independent approvals, concurrent updates and restore procedures against staging before using real records.

Secure cookies require HTTPS in production. `APP_URL` must exactly match the browser origin for authenticated mutations. No common demo passwords or shared staff credentials are provided.

## Backups and private storage

Schedule encrypted database backups with an independent retention location; test restoration before launch. Define retention with Accounts and HR. cPanel document storage should be outside `public_html` and exposed only through authenticated download endpoints. This implementation does not yet include file upload/download or a document-storage adapter: do not place private HR or customer documents in `public/`.

## Jobs and integrations

Reminder indicators currently derive from saved due dates while the app is open. There is no background worker, email scheduler or WhatsApp sender yet. Do not configure a pretend cron job. Implement a durable outbox, retries, idempotency and per-company notification rules before enabling outbound automation.

Website HMAC intake setup is in `INTEGRATIONS.md`. Add proxy request-size/rate limits before public exposure. Configure an application monitoring sink without logging passwords, tokens or full HR/financial payloads.

## Rollback

Preserve the prior application release and database backup before each approved deployment. Avoid destructive schema resets. Use reviewed forward migrations; test any restore in isolation before replacing a production database.
