# Runbooks

How to run MomentumDesk day to day on the VPS (decision D9), what to watch,
and what to do when something goes wrong. Commands run from `deploy/` on the
server unless noted. Set-up itself is in `docs/go-live.md`.

## Monitoring

| What | How | Alert when |
|---|---|---|
| App, database and worker | An uptime monitor (e.g. Better Stack, UptimeRobot) on `https://momentumdesk.app/api/health?strict=1` every minute | Not 200 for 3 minutes. The JSON says which check failed: `database` or `worker` (`stale`: no worker seen for 5 minutes; `missing`: none has run) |
| Errors | Sentry (D8). Add an alert rule for new issues and for a spike in events | Any new issue; more than 20 events in 10 minutes |
| Background work | Settings → Failed background work, in each workspace; `docker compose logs worker` | A job failed every retry (reminders, exchange rates). Fix the cause, then press Retry |
| Disk | `df -h` on the server; Docker volumes `pgdata` and `caddy_data` | Over 80% full |
| Backups | `ls -l deploy/backups` and the off-server copy | No dump from the last night, or the off-server copy is older than a day |
| Certificates | Caddy renews them; `docker compose logs caddy` | Renewal errors (usually DNS or a closed port 80) |
| Dependencies | `pnpm audit --prod` in the repository, monthly and on every published advisory for Next.js, Better Auth or Prisma | Any high or critical finding: upgrade, run all checks, deploy |

## Restore drill

Do this once a quarter and after any change to the database or the backup
script. Record the result below.

1. Take a fresh backup: `./backup.sh`.
2. On a spare machine (or a copy of the server), start the database only:
   `docker compose up -d --wait db`.
3. Restore: `docker compose exec -T db pg_restore --username momentum_owner --dbname momentum --exit-on-error < backups/<file>.dump`.
4. Run `./deploy.sh` (migrations report nothing pending; grants are reapplied).
5. Check: `/api/health` is ok; sign in; the latest invoices and payments are there.
6. Check isolation survived: as `momentum_app`, `select count(*) from customer` returns 0 without a workspace set.

| Date | Who | Backup size | Restore to serving | Result |
|---|---|---|---|---|
| 2026-11-20 | Claude (staging stack in the build environment) | 220 KB | 14 s | Data back; health ok; row-level security intact (0 rows without a workspace, 1 with) |

## Incidents

1. **Assess.** `curl https://momentumdesk.app/api/health?strict=1`, `docker compose ps`, `docker compose logs --tail 200 app worker`, Sentry.
2. **Stabilise.**
   - App down, database fine: `docker compose restart app`.
   - Worker stale: `docker compose restart worker`. Missed reminders are planned again on its next daily run; nothing is sent twice.
   - Database down: `docker compose logs db`; check disk space first.
   - A bad deploy: check out the previous commit and run `./deploy.sh`. Migrations only move forward. If the new migration must be undone, restore the backup taken before the deploy.
3. **Tell people.** If customers or payments were affected for more than 15 minutes, email the pilot businesses: what happened, what to check, and when it was fixed.
4. **Afterwards.** Write down the cause and the fix, and add a test or alert that would have caught it.

### Security incidents

- Suspected leaked key: rotate it at the provider (Resend, the AI provider, Sentry) and in `deploy/.env`, then run `./deploy.sh`.
- `PROVIDER_SECRETS_KEY` leaked: every workspace must reconnect its payment providers with new keys after it is changed (stored keys become unreadable). Tell owners first.
- `BETTER_AUTH_SECRET` changed: everyone is signed out.
- Personal data exposed: record what, whose and when, and follow the notification duties in the privacy policy and the pilot countries' laws (to be completed with the lawyer, D40).

## Support

Pilot support goes to [SUPPORT EMAIL], answered within [one working day].

| Request | What to do |
|---|---|
| "My customer didn't get the invoice" | The invoice page lists links and views. Check the customer's email address on the invoice, then use Email again. Emails go through Resend: its dashboard shows bounces |
| "The customer's link doesn't work" | It may have been revoked. Create a new link on the quote or invoice page |
| Payment made but not showing | Online: on the invoice page, check the attempt, or let the provider's webhook arrive (its dashboard shows deliveries). Manual: record it on the invoice |
| Wrong payment recorded | Void it with a reason on the invoice page (not possible once refunded) and record the right one |
| Refund | From the payment on the invoice page: through the provider, or recorded when paid back another way |
| Reminders went to the wrong person or too often | Stop them for that customer (customer page), or pause the invoice's collection. Settings shows the steps and the minimum gap |
| Locked out | Use "Forgot password" or a sign-in link. An owner can re-invite a removed member |
| Export or delete my data | Owners and admins: Settings → Your data → Download everything. A customer asking to be forgotten: the customer's page → Erase personal data (owners and admins). Closing the workspace: Settings → Close workspace (owners); deleted 30 days later unless cancelled |
| AI not available | Settings → Momentum AI shows whether it is on and this month's use. The limit resets monthly; owners can raise it up to the server's `AI_MONTHLY_LIMIT` |
