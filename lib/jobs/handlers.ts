import { fetchOpenExchangeRates, refreshRates } from "@/lib/fx/provider";
import type { Http } from "@/lib/payments/providers";
import { reviewReceivables } from "@/lib/receivables/service";
import type { JobHandler } from "./worker";

/**
 * Every kind of background job the worker can run (decision D18). Each
 * handler is idempotent: running it twice for the same key changes nothing
 * more than running it once.
 */

export interface HandlerDeps {
  /** A workspace's settings (the organization table is not tenant data). */
  organization(id: string): Promise<{ baseCurrency: string; timezone: string } | null>;
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
  };
}

/** Job kinds enqueued once a day for every workspace. */
export const DAILY_JOBS = ["fx.refresh", "receivables.review"];
