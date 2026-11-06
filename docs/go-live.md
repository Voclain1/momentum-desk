# Go-live checklist

Everything needed to put MomentumDesk on `momentumdesk.app`, in order, in one
sitting. Each step says where to do it and what it produces. Nothing here is
stored in the repository: secrets go into Vercel's environment variables only.

Allow about an hour. DNS for the email domain can take longer to verify; the
app works without it except for sending email.

## 1. Neon (database)

1. Create a Neon project in the region closest to your users. Its default
   branch is production.
2. In the Neon SQL editor, as the owner role, create the restricted role the
   app runs as. Use a long random password:

   ```sql
   CREATE ROLE momentum_app LOGIN PASSWORD '<random password>'
     NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
   ```

   This is required, not optional: Neon's owner role bypasses row-level
   security, so connecting the app as the owner would switch off one of the
   two tenant-isolation layers (`docs/tenant-isolation.md`).
3. Note two connection strings for the production branch:
   - **Owner, direct** (not pooled) → `MIGRATION_DATABASE_URL`
   - **`momentum_app`, pooled** → `DATABASE_URL`
4. Apply migrations and grant the app role its privileges, from a machine with
   the repository checked out:

   ```bash
   MIGRATION_DATABASE_URL='<owner direct URL>' pnpm db:deploy
   psql '<owner direct URL>' -v app_role=momentum_app -f prisma/sql/app-role.sql
   ```

   Later migrations run automatically on each deploy (step 5) and the grants
   cover new tables.
5. Previews (optional): install Neon's Vercel integration so each preview
   deployment gets its own database branch. Branches copy roles and grants
   from production. Point the preview variables at the branch.

## 2. Resend (email)

1. Add the domain `momentumdesk.app` in Resend.
2. Add the DNS records Resend shows (SPF and DKIM; DMARC recommended) at your
   DNS provider, and wait until Resend marks the domain verified.
3. Create an API key with sending access → `RESEND_API_KEY`.
4. Choose the sender → `EMAIL_FROM`, e.g.
   `MomentumDesk <no-reply@momentumdesk.app>`.

Without these, the app runs but cannot send sign-in links, password resets,
email confirmations or invitations; invitees cannot join.

## 3. Sentry (error monitoring)

1. Create a Sentry project for the Next.js platform.
2. Copy its DSN → `NEXT_PUBLIC_SENTRY_DSN` (not a secret; the browser uses it).
3. For readable stack traces, create an auth token with source map upload
   rights → `SENTRY_AUTH_TOKEN`, and note the organization and project slugs
   → `SENTRY_ORG`, `SENTRY_PROJECT`.

Without these, the app runs with error monitoring off.

## 4. Auth secret

Generate one per environment (production and preview must differ):

```bash
openssl rand -base64 32
```

→ `BETTER_AUTH_SECRET`. Changing it later signs everyone out.

## 5. Vercel

1. Import the GitHub repository `Voclain1/momentum-desk`. Framework: Next.js.
   Leave the build command empty: Vercel runs the `vercel-build` script, which
   applies migrations and then builds, and refuses to deploy production if
   `MIGRATION_DATABASE_URL` is missing.
2. Add environment variables:

   | Variable | Production | Preview | Secret |
   |---|---|---|---|
   | `DATABASE_URL` | Neon `momentum_app`, pooled | Neon branch, `momentum_app`, pooled | Yes |
   | `MIGRATION_DATABASE_URL` | Neon owner, direct | Neon branch owner, direct | Yes |
   | `BETTER_AUTH_SECRET` | value from step 4 | a different value | Yes |
   | `APP_URL` | `https://momentumdesk.app` | leave unset (uses the preview URL) | No |
   | `RESEND_API_KEY` | from step 2 | same, or unset to keep previews from emailing | Yes |
   | `EMAIL_FROM` | from step 2 | same as the key, or unset | No |
   | `NEXT_PUBLIC_SENTRY_DSN` | from step 3 | same | No |
   | `SENTRY_AUTH_TOKEN` | from step 3 | same | Yes |
   | `SENTRY_ORG`, `SENTRY_PROJECT` | from step 3 | same | No |

   `RESEND_API_KEY` and `EMAIL_FROM` must be set together; the app refuses to
   start with only one.
3. Add the domain `momentumdesk.app` to the project and set the DNS records
   Vercel shows.
4. Deploy.

## 6. Check the deployment

1. `https://momentumdesk.app/api/health` returns `{"status":"ok", ...}` with the
   deployed commit as `version`.
2. Create an account, then a workspace with its settings.
3. Sign out and sign in with an emailed link (checks Resend).
4. Invite a second address from Team, accept it from that address's inbox,
   and confirm the new member sees the workspace with the right role.
5. In Sentry, confirm the project receives events once the first error occurs
   (Sentry's project setup page can also wait for a first event). Open one and
   check it carries only internal user and workspace ids, never an email.
6. Point an uptime monitor at `/api/health` (503 means the database is
   unreachable).

## If something fails

- Build stops with "MIGRATION_DATABASE_URL is not set": add it for that
  environment.
- App fails to start with "Invalid environment variables": the message names
  each variable and what is wrong with it.
- `/api/health` returns 503: check `DATABASE_URL` and that `app-role.sql` was
  run. The database test "cannot bypass row-level security" explains the role
  requirement.
- Emails do not arrive: check the domain is verified in Resend and the sender
  in `EMAIL_FROM` uses that domain.
