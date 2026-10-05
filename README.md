# Momentum Desk

AI Revenue Operations for growing businesses. Momentum Desk connects the path from lead to quote, invoice, payment and collections.

## Current increment

- Next.js 16 App Router foundation
- Responsive revenue operations dashboard shell
- Initial product navigation and workflow language
- Ready for tenant, authentication and domain-model implementation

## Run locally

```bash
pnpm install
pnpm dev
```

## Build principles

- Every business record is tenant-scoped.
- Money is stored in integer minor units with an ISO 4217 currency code.
- Published quotes and finalized invoices are immutable snapshots.
- Payment providers sit behind an adapter and update state through idempotent webhooks.
- Momentum integrates with accounting systems; it is not a general ledger.
