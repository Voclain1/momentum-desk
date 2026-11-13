# Go-live checklist

Everything needed to put MomentumDesk on `momentumdesk.app` on one VPS
(decision D9), in order, in one sitting. Nothing here is stored in the
repository: secrets live only in `deploy/.env` on the server.

What runs (`deploy/compose.yaml`, one image built from `Dockerfile`):

| Service | Does |
|---|---|
| `db` | PostgreSQL 16, data in the `pgdata` volume. Creates the restricted `momentum_app` role on first start. |
| `migrate` | Applies pending migrations as the database owner, then exits. |
| `grants` | Grants `momentum_app` its privileges (`prisma/sql/app-role.sql`), then exits. |
| `app` | The Next.js server. Starts only after `migrate` and `grants` succeed, so new code never runs on an old schema. |
| `worker` | Background jobs (D18): reminders, exchange rates, the daily receivables review. |
| `caddy` | HTTPS on ports 80/443 with automatic certificates; the only service exposed. |

Allow about an hour. DNS for the email domain can take longer to verify; the
app works without it except for sending email.

## 1. Server

1. A VPS with at least 2 GB RAM and 20 GB disk, running a current Ubuntu or
   Debian. Building the image needs the memory; the app itself uses less.
2. Install Docker Engine with the compose plugin (Docker's own install guide
   for your distribution), and open ports 80 and 443 (and 22 for SSH) in the
   firewall. Nothing else needs to be reachable: PostgreSQL is not published.
3. Point DNS for `momentumdesk.app` (A, and AAAA if the server has IPv6) at the
   server. Caddy obtains the certificate once DNS resolves.
4. Clone the repository on the server:

   ```bash
   git clone https://github.com/Voclain1/momentum-desk.git
   cd momentum-desk/deploy
   cp .env.example .env && chmod 600 .env
   ```

## 2. Database

Nothing to do by hand. On first start the `db` service creates the database
and the `momentum_app` role (`deploy/postgres-init.sh`) with
`APP_DB_PASSWORD`; the app connects as that role, which cannot bypass
row-level security or change the schema (`docs/tenant-isolation.md`).
Migrations run as the owner (`momentum_owner`, `DB_OWNER_PASSWORD`).

## 3. Resend (email)

1. Add the domain `momentumdesk.app` in Resend.
2. Add the DNS records Resend shows (SPF and DKIM; DMARC recommended) at your
   DNS provider, and wait until Resend marks the domain verified.
3. Create an API key with sending access → `RESEND_API_KEY`.
4. Choose the sender → `EMAIL_FROM`, e.g.
   `MomentumDesk <no-reply@momentumdesk.app>`.

Without these, the app runs but cannot send sign-in links, password resets,
email confirmations or invitations; invitees cannot join.

## 4. Sentry (error monitoring)

1. Create a Sentry project for the Next.js platform.
2. Copy its DSN → `NEXT_PUBLIC_SENTRY_DSN` (not a secret; the browser uses it).
3. For readable stack traces, create an auth token with source map upload
   rights → `SENTRY_AUTH_TOKEN`, and note the organization and project slugs
   → `SENTRY_ORG`, `SENTRY_PROJECT`. These are used only while building the
   image; the token is passed as a build secret and never stored in it.

Without these, the app runs with error monitoring off.

## 5. Secrets

Generate each with `openssl rand -base64 32` (a different value for each, and
for a staging server if you run one):

- `BETTER_AUTH_SECRET`: signs sessions. Changing it later signs everyone out.
- `PROVIDER_SECRETS_KEY`: see step 6.

Database passwords go into connection URLs, so use letters and digits only:
`openssl rand -hex 24` for each of `DB_OWNER_PASSWORD` and `APP_DB_PASSWORD`.

## 6. Payment providers (optional; online invoice payment)

Each workspace connects its own Paystack, Stripe or Bachs account in
Settings → Payment providers; MomentumDesk never holds the money (D19, D35).
The server needs one secret to encrypt those keys:

```bash
openssl rand -base64 32
```

→ `PROVIDER_SECRETS_KEY`. Changing it
later makes stored provider keys unreadable: workspaces would reconnect.

Before taking live payments with a provider, run one test-mode payment end to
end with its test keys:

1. Connect the provider with test keys; copy the webhook URL shown.
2. Add that URL in the provider's dashboard (Paystack: Settings → API Keys &
   Webhooks; Stripe: Developers → Webhooks, events `checkout.session.completed`
   and `checkout.session.async_payment_succeeded`, then paste its signing
   secret; Bachs: its webhooks page, then paste its signing secret).
3. Pay a small invoice from its public link and check it shows as paid, with
   the payment listed as confirmed by the provider. Then refund part of it
   from the invoice page (Paystack, Stripe) and check the refund settles
   (Paystack's refund webhooks are `refund.processed` and `refund.failed`;
   for Stripe also send `refund.updated`).
4. **Bachs only:** the adapter follows Bachs's quickstart and third-party
   SDKs because its full reference could not be read while building it.
   Confirm in the sandbox that amounts, currency and the webhook signature
   match (`lib/payments/providers/bachs.ts`); a mismatch is refused, never
   recorded, so a failed sandbox payment shows what to fix.

## 7. Fill in deploy/.env

| Variable | Value | Secret |
|---|---|---|
| `DOMAIN` | `momentumdesk.app` (APP_URL becomes `https://` + this) | No |
| `DB_OWNER_PASSWORD`, `APP_DB_PASSWORD` | step 5 | Yes |
| `BETTER_AUTH_SECRET` | step 5 | Yes |
| `PROVIDER_SECRETS_KEY` | step 6 | Yes |
| `RESEND_API_KEY` | step 3 | Yes |
| `EMAIL_FROM` | step 3 | No |
| `FX_PROVIDER_KEY` | Open Exchange Rates app id (optional; staff can enter rates in Settings) | Yes |
| `NEXT_PUBLIC_SENTRY_DSN` | step 4 | No |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` | No |
| `SENTRY_ORG`, `SENTRY_PROJECT` | step 4 (optional) | No |

`RESEND_API_KEY` and `EMAIL_FROM` must be set together; the app refuses to
start with only one. The database passwords are read when the volume is
first created: changing them later needs `ALTER ROLE` in the database too.

## 8. Start

```bash
cd momentum-desk/deploy
export SENTRY_AUTH_TOKEN=...   # optional, for readable stack traces
./deploy.sh
```

`deploy.sh` builds the image (tagged with the commit), starts the database,
runs `migrate` and `grants` on their own, and only then starts or replaces
`app`, `worker` and `caddy`. All should show "Up". Logs:
`docker compose logs -f app worker`.

### Deploying an update

```bash
cd momentum-desk && git pull && deploy/deploy.sh
```

If a migration or the grants fail, the script stops before touching the
running app and worker, which keep serving the previous version;
`docker compose logs migrate` says why. (A plain `docker compose up -d` would
stop the old app first, so use the script.) Take a backup (step 9) before an
update that adds migrations.

## 9. Backups

1. Nightly dump, kept 14 days (`BACKUP_KEEP_DAYS` to change), via cron:

   ```cron
   15 2 * * * cd /path/to/momentum-desk/deploy && ./backup.sh >> backups/backup.log 2>&1
   ```

2. Copy `deploy/backups/` off the server (for example `rclone` or `restic` to
   object storage). A backup on the same disk does not survive losing the
   server.
3. Restore test, once now and after major changes:

   ```bash
   docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_test && pg_restore -U "$POSTGRES_USER" -d restore_test --no-owner' < backups/<file>.dump
   docker compose exec -T db psql -U momentum_owner -d restore_test -c 'select count(*) from organization'
   docker compose exec -T db dropdb -U momentum_owner restore_test
   ```

   To restore for real: stop `app` and `worker`, drop and recreate
   `momentum`, `pg_restore` into it, then `docker compose up -d` (which
   reapplies the grants).

## 10. Check the deployment

1. `https://momentumdesk.app/api/health` returns `{"status":"ok", ...}` with the
   deployed commit as `version`.
2. Create an account, then a workspace with its settings.
3. Sign out and sign in with an emailed link (checks Resend).
4. Invite a second address from Team, accept it from that address's inbox,
   and confirm the new member sees the workspace with the right role.
5. `docker compose logs worker` shows "worker started" and, within a minute,
   the day's jobs for the new workspace. With `FX_PROVIDER_KEY` set,
   Settings → Exchange rates lists the day's rates.
6. In Sentry, confirm the project receives events once the first error occurs
   (Sentry's project setup page can also wait for a first event). Open one and
   check it carries only internal user and workspace ids, never an email.
7. Point an uptime monitor at `/api/health` (503 means the database is
   unreachable).

## If something fails

- `docker compose up` stops with "set DOMAIN" or a similar message: that
  variable is missing from `deploy/.env`.
- App or worker exits with "Invalid environment variables": the message names
  each variable and what is wrong with it.
- `/api/health` returns 503: check `docker compose logs db grants` and that
  `APP_DB_PASSWORD` matches the role's password.
- No certificate: DNS does not point at the server yet, or ports 80/443 are
  closed; `docker compose logs caddy` says which.
- Emails do not arrive: check the domain is verified in Resend and the sender
  in `EMAIL_FROM` uses that domain.
- Reminders not sent: they are off until an owner turns them on in Settings;
  the invoice page lists each reminder step with the reason it was skipped.
- A background job failed every retry: Settings → Failed background work
  shows it, with a Retry button, once the cause is fixed.
