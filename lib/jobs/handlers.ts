import { fetchOpenExchangeRates, refreshRates } from "@/lib/fx/provider";
import type { Http } from "@/lib/payments/providers";
import type { EmailSender } from "@/lib/email";
import { reviewReceivables } from "@/lib/receivables/service";
import { planReminders, sendReminder } from "@/lib/reminders/service";
import { todayIn } from "@/lib/dates";
import type { JobHandler } from "./worker";

/**
 * Every kind of background job the worker can run (decision D18). Each
 * handler is idempotent: running it twice for the same key changes nothing
 * more than running it once.
 */

export interface HandlerDeps {
  /** A workspace's settings (the organization table is not tenant data). */
  organization(id: string): Promise<{ name: string; baseCurrency: string; timezone: string; locale: string } | null>;
  email: EmailSender;
  /** The app's public origin, for links in reminders (APP_URL). */
  appUrl: string | undefined;
  /** Open Exchange Rates app id (FX_PROVIDER_KEY); without it only staff rates exist. */
  fxProviderKey: string | undefined;
  http: Http;
}

const dayOf = (payload: unknown) => {
  const day = (payload as { day?: string } | null)?.day;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Job payload has no day");
  return day;
};

export function createJobHandlers(deps: HandlerDeps): Record<string, JobHandler> {
  return {
    /** Daily provider rates for the currencies the workspace invoices in (D38). */
    "fx.refresh": async ({ data, job }) => {
      const organization = await deps.organization(job.organizationId);
      if (!organization) return;
      const key = deps.fxProviderKey;
      await refreshRates(data, job.organizationId, {
        day: dayOf(job.payload),
        base: organization.baseCurrency,
        fetchTable: key ? () => fetchOpenExchangeRates(key, deps.http) : null,
      });
    },
    /** Promises kept or broken, pauses ended (spec §7.7). */
    "receivables.review": async ({ data, job }) => {
      await reviewReceivables(data, job.organizationId, dayOf(job.payload));
    },
    /** Plans the day's reminders; runs after the review so promises and pauses are current. */
    "reminders.run": async ({ data, job, now }) => {
      await reviewReceivables(data, job.organizationId, dayOf(job.payload));
      await planReminders(data, job.organizationId, dayOf(job.payload), now);
    },
    /** Sends one reminder after checking again that it should go out. */
    "reminders.send": async ({ data, job, now }) => {
      const organization = await deps.organization(job.organizationId);
      if (!organization) return;
      if (!deps.appUrl) throw new Error("APP_URL is not set, so reminder links cannot be made");
      const executionId = (job.payload as { executionId?: string } | null)?.executionId;
      if (!executionId) throw new Error("Job payload has no reminder");
      await sendReminder(data, job.organizationId, executionId, todayIn(organization.timezone, now), {
        email: deps.email,
        appUrl: deps.appUrl,
        seller: organization.name,
        locale: organization.locale,
      }, now);
    },
  };
}

/** Job kinds enqueued once a day for every workspace. */
export const DAILY_JOBS = ["fx.refresh", "receivables.review", "reminders.run"];
