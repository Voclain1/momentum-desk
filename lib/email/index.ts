/**
 * Provider-neutral transactional email (docs/product-spec.md §11). The
 * provider is decision D17 and still open, so production has no sender yet:
 * anything that needs email fails loudly there instead of silently dropping
 * the message.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("No email provider is configured (decision D17), so this email cannot be sent.");
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

export function defaultEmailSender(nodeEnv: string | undefined): EmailSender {
  return nodeEnv === "production" ? unconfiguredEmailSender : consoleEmailSender;
}
