/**
 * Provider-neutral transactional email (docs/product-spec.md §11). The
 * provider is Resend (decision D17, lib/email/resend.ts). Without an API key,
 * development prints messages to the server log and production refuses to
 * send, loudly, rather than silently dropping the message.
 */

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

export interface EmailConfig {
  NODE_ENV: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

/** Resend when configured; otherwise the log in development and a refusal in production. */
export function defaultEmailSender(config: EmailConfig): EmailSender {
  if (config.RESEND_API_KEY && config.EMAIL_FROM) {
    return createResendEmailSender({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM });
  }
  return config.NODE_ENV === "production" ? unconfiguredEmailSender : consoleEmailSender;
}

/** Whether emails actually leave the server (Resend configured). */
export function emailIsDelivered(config: EmailConfig): boolean {
  return Boolean(config.RESEND_API_KEY && config.EMAIL_FROM);
}
