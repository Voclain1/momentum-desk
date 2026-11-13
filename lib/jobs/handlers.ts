import type { JobHandler } from "./worker";

/**
 * Every kind of background job the worker can run (decision D18). Each
 * handler must be idempotent. Receivables and reminders add theirs in M5.
 */
export const JOB_HANDLERS: Record<string, JobHandler> = {};

/** Job kinds enqueued once a day for every workspace. */
export const DAILY_JOBS: string[] = [];
