/**
 * Provider-neutral transactional email (docs/product-spec.md §11). The
 * provider is Resend (decision D17, lib/email/resend.ts). Without an API key,
 * development prints messages to the server log and production refuses to
 * send, loudly, rather than silently dropping the message.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { isLocalUrl } from "@/lib/env";
import { createResendEmailSender } from "./resend";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Stops a retried request from sending the same email twice. */
  idempotencyKey?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured (set RESEND_API_KEY and EMAIL_FROM), so this email cannot be sent.");
    this.name = "EmailNotConfiguredError";
  }
}

/** Development: print the message, including any sign-in link, to the server log. */
export const consoleEmailSender: EmailSender = {
  async send({ to, subject, text }) {
    console.info(`\n[email] to: ${to}\n[email] subject: ${subject}\n${text}\n`);
  },
};

export const unconfiguredEmailSender: EmailSender = {
  async send() {
    throw new EmailNotConfiguredError();
  },
};

/** Tests: keep messages in memory so a test can read links out of them. */
export function createMemoryEmailSender() {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message: EmailMessage) {
      sent.push(message);
    },
    lastTo(to: string) {
      return sent.findLast((message) => message.to === to);
    },
  } satisfies EmailSender & Record<string, unknown>;
}

/** End-to-end tests: append each message to a file as one JSON line. */
export function createFileEmailSender(path: string): EmailSender {
  return {
    async send({ to, subject, text }) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify({ to, subject, text, at: new Date().toISOString() }) + "\n");
    },
  };
}

export interface EmailConfig {
  NODE_ENV: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  APP_URL?: string;
  EMAIL_TEST_OUTBOX?: string;
}

/** Whether the end-to-end outbox is in use: set, and only for a localhost app. */
const usesTestOutbox = (config: EmailConfig) => Boolean(config.EMAIL_TEST_OUTBOX) && isLocalUrl(config.APP_URL);

/**
 * The end-to-end outbox for a local test server; otherwise Resend when
 * configured, the log in development and a refusal in production.
 */
export function defaultEmailSender(config: EmailConfig): EmailSender {
  if (usesTestOutbox(config)) return createFileEmailSender(config.EMAIL_TEST_OUTBOX!);
  if (config.RESEND_API_KEY && config.EMAIL_FROM) {
    return createResendEmailSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM });
  }
  return config.NODE_ENV === "production" ? unconfiguredEmailSender : consoleEmailSender;
}

/** Whether emails actually leave the server (Resend configured). */
export function emailIsDelivered(config: EmailConfig): boolean {
  return Boolean(config.RESEND_API_KEY && config.EMAIL_FROM) || usesTestOutbox(config);
}
