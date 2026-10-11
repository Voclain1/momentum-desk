# MomentumDesk — Product Specification & Technical Blueprint

**Domain:** `momentumdesk.app`  
**Product category:** AI revenue operations  
**Positioning:** The AI revenue desk for growing businesses  
**Core promise:** Turn enquiries into paying customers—and keep revenue moving.  
**Status:** Working specification for MVP planning and implementation  
**Scope principle:** Global-first, multi-currency from day one.

---

## 1. Product vision

MomentumDesk helps businesses manage the journey from first enquiry to collected revenue in one connected workspace:

**Lead → Opportunity → Quote → Invoice → Payment → Receivables → Collection**

The product should connect sales and finance workflows without trying to become a full accounting suite, marketing platform, or generic business-management system.

### Product principle

> The deal is not finished when it is marked won. The revenue workflow continues until the money is collected and reconciled.

### Initial target customers

Start with service-led and B2B businesses that receive enquiries, prepare quotations, invoice customers, and manually follow up on outstanding payments. Examples include:

- Solar and renewable-energy installers
- Digital, creative, and IT agencies
- Contractors and construction-related services
- Interior, furniture, and equipment businesses
- Consultants and professional-services firms
- Training and education businesses
- Travel and logistics companies
- B2B suppliers and distributors

Do not hard-code the product to a particular industry or country. Industry-specific templates can be added later.

---

## 2. Positioning and brand

**Brand:** MomentumDesk  
**Suggested descriptor:** AI Revenue Operations for growing businesses  
**Suggested headline:** Turn enquiries into revenue.  
**Supporting copy:** MomentumDesk brings your leads, quotations, invoices, payments, and follow-ups together—with AI helping your team move every opportunity from first conversation to final payment.

**Short supporting line:** Leads. Quotes. Invoices. Payments. Collections. One desk.

The brand should communicate a serious, dependable B2B product. Avoid presenting it as merely a CRM, invoice generator, WhatsApp bot, or payment processor.

---

## 3. Product strategy

MomentumDesk should combine the connected workflow strengths of several categories while keeping its scope focused:

- CRM and pipeline management
- Quote and proposal workflows
- Invoicing and payment tracking
- Payment-provider integrations
- Accounts-receivable visibility and collections automation
- AI assistance throughout the workflow

The differentiation is the connected journey, not an attempt to reproduce every feature of a large incumbent.

### Competitive benchmark set

Use the following products as research references. Re-check current product documentation, plan restrictions, regional availability, and feature changes before implementing each module.

| Product | Benchmark area | Questions to investigate |
|---|---|---|
| HubSpot Sales Hub / Commerce Hub | CRM, deal pipeline, quotes, quote acceptance, payments | How do deals connect to quotes, signatures, invoices, and payments? Which features require higher plans? |
| Pipedrive | Sales pipeline and activity management | How quickly can a salesperson see the next action, manage a deal, and track conversion? |
| Zoho Books | Multi-currency invoicing and receivables | How are transaction currency, base currency, exchange rates, reminders, taxes, and reporting handled? |
| QuickBooks Online | Invoicing and financial workflows | How are estimates, invoices, partial payments, foreign currency, and payment status represented? |
| Xero | Invoicing and multi-currency accounting context | How are foreign-currency transactions and reporting handled? What should remain the accounting system's responsibility? |
| FreshBooks | Service-business estimates, invoices, deposits, payment schedules | How does the estimate-to-invoice workflow feel for a small service business? |
| HighLevel | CRM, opportunities, estimates, invoices, payments, automation | How are CRM and billing connected? Which automation patterns are practical for SMBs? |
| Stripe | Online payment infrastructure | How should payment intents/checkout, webhooks, refunds, disputes, and idempotency be handled? |
| Paystack | African payment infrastructure | Which currencies and countries are supported? How do checkout, webhook verification, and reconciliation work? |
| Flutterwave | African/international payment infrastructure | Which countries, currencies, and methods are supported? |
| BILL | Accounts payable/receivable workflows | How are receivables, reminders, and payment workflows surfaced? |
| Chaser | Collections automation | How are reminder schedules, channels, promises to pay, disputes, and human escalation handled? |

### Required competitor-study deliverable

Before finalizing each major module, create a short benchmark with:

1. Current competitor capabilities, confirmed from official documentation.
2. Plan/region restrictions and limitations.
3. Expected industry-standard baseline.
4. UX patterns worth learning from.
5. Friction or gaps MomentumDesk can improve.
6. Explicit V1 requirements, later requirements, and non-goals.
7. Source links and date checked.

Do not copy competitor branding or assume a feature is available in every country or subscription tier.

---

## 4. V1 scope

### V1 modules

1. Dashboard
2. Customers and contacts
3. Leads and opportunities
4. Sales pipeline and activities
5. Product/service catalogue
6. Quotes
7. Invoices
8. Payment recording and provider integrations
9. Receivables and collections reminders
10. Momentum AI assistance
11. Organization settings, team roles, audit history, and integrations

### Defer beyond initial V1

- Full general-ledger accounting
- Payroll and expense accounting
- Inventory/warehouse management
- Marketing CMS and ad management
- A full omnichannel inbox
- Autonomous AI sales agents that send unsupervised messages
- Native mobile apps
- Advanced custom workflow builder
- Contracts and advanced e-signatures
- Credit notes and complex accounting adjustments (design for future support)
- Recurring billing beyond the initial architecture and any essential pilot needs
- Dozens of payment providers at launch

**Scope test:** Does this feature help a business move from enquiry to collected revenue? If not, defer it unless a pilot customer demonstrates a compelling need.

---

## 5. Global-first and multi-currency requirements

Multi-currency is foundational infrastructure, not a later enhancement.

### 5.1 Organization settings

Each organization should have separate settings for:

- `baseCurrency` — reporting currency for the organization
- `countryCode` — ISO country code
- `locale` — language and regional formatting preference
- `timezone` — IANA timezone, e.g. `Europe/London`
- `defaultLanguage`
- `defaultInvoiceCurrency` — optional default for new documents
- Tax configuration and business registration details, where applicable

Do not infer currency solely from country, language, or locale. A company can operate in one country, use a different reporting currency, and invoice customers in several currencies.

### 5.2 Transaction currency

Quotes, invoices, payments, refunds, and payment attempts must carry explicit currency information where applicable.

A quote or invoice has one currency for all line items in that document. Do not support mixed-currency line items within one quote or invoice in V1.

A customer's preferred currency can be a default, but it must not silently override an existing document's currency.

### 5.3 Amount storage

- Never use IEEE floating-point values for financial arithmetic.
- Use integer minor units where the currency's minor-unit rules support that representation, paired with authoritative currency metadata.
- Do not assume all currencies have two decimal places. Support zero-decimal and other currency-specific minor-unit rules.
- Define rounding rules explicitly for tax, discounts, exchange-rate conversion, and payment allocation.
- Use decimal-safe arithmetic in the domain layer.
- Format amounts using a standards-aware internationalization library/API and currency metadata.
- Validate that amount, currency, and precision are compatible.

A persisted amount must always be interpretable alongside its currency.

### 5.4 Exchange rates and historical integrity

The organization’s base currency is used for reporting, not to rewrite original transactions.

For foreign-currency transactions, store a rate snapshot when a base-currency equivalent is needed. Record:

- Base currency
- Transaction currency
- Rate
- Rate source
- Rate timestamp/effective date
- Conversion purpose
- Converted amount, when needed for reporting

Never retroactively rewrite issued invoices, completed payments, or historical reports because an exchange rate changes.

Do not invent rates or silently convert a document. If conversion is offered, show the source, timestamp, and rate and require confirmation where material.

### 5.5 Reporting

- Document views show the document's original currency.
- Organization-level reports use the organization's base currency for normalized totals.
- Reports should distinguish original-currency totals from converted reporting totals.
- Do not add raw amounts from different currencies together.
- If a rate is missing, show that the converted value is unavailable or incomplete rather than implying a precise total.
- Dashboard widgets should make their currency basis clear.

### 5.6 Currency examples for tests

Include test cases for:

- USD, GBP, EUR, NGN, GHS, KES, ZAR, INR, JPY, and KWD
- A zero-decimal currency
- A currency with three minor-unit digits
- Different locale formats for the same currency
- Currency conversion with a fixed historical rate
- Partial payments and outstanding balances in the invoice's currency
- Organization reporting across invoices in different currencies
- Missing exchange rate and stale-rate behaviour

These are test examples, not a promise that every payment provider supports every listed currency.

---

## 6. Payments architecture

MomentumDesk is not a wallet or a custodian of customer funds. Customer payments should flow through a merchant's configured provider/account, subject to provider availability and eligibility.

### Provider-neutral domain model

Treat payment providers as adapters, not as the core payment system.

Potential providers to evaluate:

- Stripe
- Paystack
- Flutterwave
- Manual/bank-transfer recording

Do not promise a provider or currency in a country until its current supported-country, merchant-eligibility, currency, and payment-method documentation has been checked.

### Payment lifecycle requirements

- Create a payment attempt with an internal identifier.
- Store the provider and provider reference.
- Verify webhook signatures using the provider's official method.
- Make webhook handling idempotent and retry-safe.
- Treat browser redirects as UX signals only; never rely on a success redirect alone to mark an invoice paid.
- Reconcile payment status from trusted provider events/API responses.
- Record payment allocations to invoices.
- Support partial payments and multiple payments against an invoice.
- Handle failed, pending, cancelled, refunded, and disputed states distinctly.
- Keep an auditable history of status changes.
- Never store raw card details.
- Keep provider-specific data in adapter/metadata structures, not scattered throughout core business logic.

### Currency constraints

A payment attempt must use a provider-supported currency and amount for that merchant account. The invoice currency, checkout currency, and settlement currency may differ only where the provider explicitly supports that flow and the product clearly records the relationship. Never assume the merchant settles in the same currency the customer pays.

---

## 7. Functional requirements by module

### 7.1 Dashboard

Provide a clear view of:

- New leads and qualified opportunities
- Pipeline value, with currency basis clearly stated
- Quotes awaiting a response
- Invoices issued
- Payments received
- Outstanding receivables
- Overdue receivables
- Leads needing follow-up
- Quotes expiring soon
- Invoices due soon
- Tasks requiring attention

A potential future metric is “revenue collected after a MomentumDesk reminder,” but do not claim a reminder caused payment unless the attribution method is defined and disclosed.

### 7.2 Leads and pipeline

Lead fields:

- Name and/or company
- Contact details
- Lead source
- Assigned owner
- Status
- Estimated value and currency
- Requirement/summary
- Next follow-up date
- Tags
- Notes
- Created and updated timestamps

Initial stages may include:

`New → Contacted → Qualified → Quote/Proposal → Won / Lost`

Keep stages configurable later; do not hard-code business logic to stage names alone.

Support:

- Search, filters, sorting, pagination
- Assignment
- Tasks and reminders
- Notes and activity timeline
- Lead-to-customer/opportunity conversion without destroying history
- Duplicate detection and merge policy
- Data import/export with permission checks

### 7.3 Customers and contacts

A customer may be a person or organization and may have multiple contacts, opportunities, quotes, invoices, and payments.

Customer record should include:

- Legal/display name
- Customer type
- Contact information
- Billing details and address
- Country and preferred locale/language
- Preferred currency (default only)
- Tax identifiers where relevant
- Notes and tags
- Communication/collection preferences
- Related activity, documents, payments, and outstanding balances

Keep customer master data separate from immutable document snapshots.

### 7.4 Product/service catalogue

Support:

- Name and description
- SKU/code (optional)
- Unit of measure (where applicable)
- Active/inactive
- Default price and currency, or explicit price-list model
- Tax behaviour/configuration
- Optional category

A quote or invoice line must snapshot its description, quantity, unit price, tax treatment, discount, and calculated amounts at issue time. Later catalogue edits must not silently alter existing documents.

Do not assume a single universal price is suitable for every currency. V1 may allow per-currency prices or manually entered line items; make this decision explicit in the implementation plan.

### 7.5 Quotes

Support:

- Quote number and organization-configurable numbering
- Customer and billing/contact snapshot
- Currency
- Issue and expiry dates
- Line items
- Fixed/percentage discounts
- Tax lines and clear tax-inclusive/exclusive behaviour
- Notes, terms, and attachments where feasible
- Deposit or payment schedule representation where included in V1
- Draft, sent, viewed, accepted, rejected, expired, and superseded states
- Public share link using a secure, non-guessable token
- Branded HTML view and downloadable PDF
- Acceptance/rejection timestamps and customer identity/evidence appropriate to the chosen acceptance model
- Quote revision/version history
- Duplicate quote
- Activity events
- Convert accepted quote to invoice without recalculating or losing the accepted snapshot

Clearly distinguish a simple quote acceptance from a legally binding electronic signature. Advanced e-signature should be integrated or deferred rather than misrepresented.

### 7.6 Invoices

Support:

- Invoice number and configurable numbering
- Customer/billing snapshot
- Currency
- Issue date and due date
- Line items, tax, discounts, notes, and terms
- Draft, issued/sent, viewed, partially paid, paid, overdue, void, and disputed states as appropriate
- Public secure invoice page
- PDF
- Payment instructions and provider checkout when configured
- Partial payments and allocations
- Outstanding balance derived from valid invoice total minus valid allocated payments/credits
- Delivery/view events
- Audit history
- Manual payment recording with permissions and audit reason
- Reminders and collection status

Avoid a single mutable status field as the sole source of truth. Status should be derived or validated against invoice totals, due dates, voiding, disputes, and allocated payments.

### 7.7 Receivables and collections

Provide aging buckets such as:

- Not yet due/current
- 1–30 days overdue
- 31–60 days overdue
- 61–90 days overdue
- 90+ days overdue

Support:

- Outstanding amount in the invoice's currency
- Base-currency reporting with documented rate snapshots
- Collection owner
- Collection status
- Promise-to-pay date and amount
- Disputed invoice flag and reason
- Internal notes
- Reminder history
- Pause/resume
- Escalation to a human
- Customer communication preferences and opt-out handling
- Stop reminders when paid, voided, paused, disputed according to policy, or covered by an agreed arrangement
- Recalculate follow-up amount after partial payments
- Retry-safe scheduling and sending

Avoid threatening, harassing, or misleading collection messages. Provide reasonable frequency controls and an audit trail.

### 7.8 Momentum AI

AI should be embedded in the workflow rather than existing only as a chatbot.

Potential V1 assistance:

- Summarize a lead or customer history
- Extract requirements from user-provided text
- Suggest a next action
- Draft follow-up messages
- Draft quote descriptions or structure proposed line items
- Draft polite collections messages based on verified invoice context
- Summarize overdue accounts for a human

Safety and quality controls:

- Human review before external messages are sent in the initial release
- AI must not invent prices, taxes, payment status, commitments, or customer facts
- Ground output in authorized organization data
- Keep sensitive data exposure to the minimum needed
- Log model/provider, task type, usage, and relevant audit metadata without unnecessarily retaining sensitive prompts
- Provide fallbacks when AI is unavailable
- Add organization-level usage limits and cost monitoring
- Make AI provider replaceable behind an internal interface

---

## 8. Globalization: locale, tax, and language

Currency is only one part of international readiness.

Keep these concerns separate:

- Country
- Currency
- Locale
- Language
- Timezone
- Tax registration and tax rules
- Business identity/numbering
- Payment-provider availability

For V1, support configurable tax lines and tax labels/rates appropriate to the organization's workflow, while explicitly avoiding a claim that MomentumDesk calculates every jurisdiction's tax compliance. Jurisdiction-specific tax engines and e-invoicing mandates require further research and later implementation.

Use locale-aware date, number, and currency formatting. Store timestamps consistently and display them in the organization's or user's chosen timezone according to a documented policy.

Do not hard-code Naira symbols, Nigerian phone formats, Nigerian address assumptions, or Nigeria-specific invoice text into shared components.

---

## 9. Data model: initial domain entities

The following is a conceptual starting point, not a final Prisma schema. Validate relationships and deletion/retention behaviour before migration.

### Identity and tenancy

- `User`
- `Organization`
- `Membership`
- `Invitation`
- `OrganizationSettings`

### CRM and sales

- `Customer`
- `Contact`
- `Lead`
- `Opportunity`
- `Pipeline`
- `PipelineStage`
- `Activity`
- `Note`
- `Task`

### Catalogue and documents

- `ProductService`
- `PriceList` or per-currency price records
- `Quote`
- `QuoteItem`
- `QuoteVersion` or immutable quote snapshots
- `QuoteEvent`
- `Invoice`
- `InvoiceItem`
- `InvoiceEvent`

### Payments and receivables

- `Payment`
- `PaymentAllocation`
- `PaymentAttempt`
- `Refund`
- `ExchangeRateSnapshot`
- `ReminderSequence`
- `ReminderStep`
- `ReminderExecution`
- `PromiseToPay`
- `CollectionCase` (if justified by the final workflow)

### Integrations, AI, and audit

- `Integration`
- `WebhookEvent`
- `AIInteraction` or minimized AI usage/audit record
- `AuditLog`
- `OutboxEvent` or equivalent reliable event-dispatch mechanism

All business data must be organization-scoped. Enforce tenant authorization server-side on every query and mutation. Do not trust an organization ID supplied by the browser without validating the current user's membership and role.

### Data integrity principles

- Use stable internal IDs; invoice/quote numbers are display identifiers, not primary keys.
- Use database transactions for critical multi-record operations.
- Add uniqueness constraints scoped to organization where appropriate.
- Snapshot document data at issue/acceptance time.
- Define deletion, retention, export, and audit policies.
- Use optimistic concurrency or explicit version checks where simultaneous edits could cause financial inconsistencies.

---

## 10. Roles and access control

Initial roles:

- **Owner:** Full access, including workspace and billing-sensitive settings.
- **Admin:** Workspace and operational management, excluding protected ownership operations.
- **Sales:** Leads, customers, opportunities, and quotes.
- **Finance:** Customers, invoices, payments, and collections.
- **Member:** Restricted access based on explicit permissions.

Implement a permission matrix and test it. Do not rely only on hiding UI controls.

Sensitive actions—voiding invoices, changing issued documents, recording manual payments, changing provider settings, exporting data, and editing roles—must have server-side authorization and audit logging.

---

## 11. Suggested technical architecture

Use the existing team’s established strengths where practical, but confirm versions and current vendor recommendations before bootstrapping.

- **Application:** Next.js, TypeScript, App Router
- **Database:** PostgreSQL
- **ORM:** Prisma or another deliberately selected typed data layer
- **Deployment:** Vercel, with production and preview environment separation
- **Background work:** Durable job/queue mechanism for reminders, email delivery, reconciliation, and scheduled tasks
- **Storage:** Object storage for logos, attachments, and generated document assets
- **Email:** Transactional email provider abstraction
- **Payments:** Provider adapters, initially selected after market/eligibility research
- **AI:** Provider-neutral application interface
- **Observability:** Structured logs, error monitoring, health checks, and key workflow metrics
- **Testing:** Unit, integration, end-to-end, authorization, and webhook tests

Keep domain/business logic out of UI components. Use clear services such as:

- `LeadService`
- `QuoteService`
- `InvoiceService`
- `PaymentService`
- `ReceivablesService`
- `CollectionService`
- `ExchangeRateService`
- `AIService`

Critical operations should be callable from the UI, API, or background jobs without duplicating business rules.

### Background job requirements

Do not rely on a browser session or a long-running request to send scheduled reminders. Background processing must support retries, idempotency, observability, and dead-letter/manual recovery where appropriate.

Use a transactional outbox or an equivalent reliable pattern for critical domain events that trigger email, payment reconciliation, or reminder jobs.

---

## 12. Security, privacy, and reliability

Required from the beginning:

- Tenant isolation and authorization tests
- Secure authentication/session handling
- Input validation on every mutation
- Rate limits on authentication, public document links, AI usage, and sensitive endpoints
- CSRF protections where relevant to the chosen auth architecture
- Webhook signature verification and replay/idempotency handling
- Secrets only in server-side environment variables/secret management
- No sensitive payment data in logs
- Secure, non-guessable public document tokens with revocation/expiry strategy
- Audit logs for important financial and permission changes
- Backups and tested recovery procedure
- Data export and deletion/retention policy
- Error monitoring and alerting
- Dependency/security update process
- Privacy disclosures for AI and integrations

Do not expose sequential database IDs or permit public quote/invoice tokens to reveal other customers' records.

---

## 13. Public URLs and customer experience

Potential routes:

- `/` — marketing site
- `/pricing`
- `/features`
- `/industries`
- `/login`
- `/signup`
- `/app` — authenticated workspace
- `/q/{secure-token}` — public quote
- `/i/{secure-token}` — public invoice

A future application subdomain may be considered, but do not introduce domain complexity before it provides a concrete benefit.

The authenticated UI should be clean, responsive, and optimized for sales/finance workflows. The next action should be obvious on each lead, quote, invoice, and collection record.

---

## 14. Onboarding

Keep initial onboarding short:

1. Create account.
2. Create organization.
3. Set country, base currency, locale, and timezone explicitly.
4. Add business name/logo and invoice details.
5. Optionally add products/services.
6. Optionally import customers/leads.
7. Enter the workspace.

Users must be able to skip catalogue/import steps and return later.

Do not assume country automatically determines base currency. Explain the base-currency choice because it affects reporting.

---

## 15. Milestones and exit criteria

### M0 — Global SaaS foundation

Build:

- Repository and application setup
- CI, lint, type-check, and test commands
- Environment validation
- Authentication
- Organization, membership, invitation foundations
- Server-side tenant guard
- Organization settings: base currency, country, locale, timezone, language
- Permission model
- Audit-log foundation
- App shell and onboarding
- Preview/production deployment separation
- Observability foundation

**Exit criteria:** A user can securely create a workspace, choose global settings, and access an isolated empty dashboard. Automated tests prove cross-tenant access is denied.

### M1 — Customers, leads, and pipeline

Build customer/contact records, leads, opportunities, activities, notes, tasks, search/filtering, assignment, import basics, and history-preserving conversion.

**Exit criteria:** A pilot business can manage its pipeline without spreadsheets for the core lead workflow.

### M2 — Catalogue and quotes

Build product/service catalogue, per-currency pricing strategy, quote builder, taxes/discounts, secure public quote, PDF, view tracking, acceptance/rejection, revision history, and quote-to-invoice conversion.

**Exit criteria:** A business can send a customer a branded quote in a chosen currency and record the customer's response without losing the accepted version.

### M3 — Invoicing

Build direct invoices, quote conversion, invoice numbering, currency/tax/discount handling, secure public invoice page, PDF, partial payment allocation model, delivery tracking, manual payment recording, and status logic.

**Exit criteria:** A business can issue and track invoices in multiple currencies without incorrect totals or status transitions.

### M4 — Payments

Choose and implement the first provider(s) after checking supported countries, currencies, merchant eligibility, settlement flows, fees, and documentation. Build checkout, webhook verification, idempotency, reconciliation, payment allocations, failure states, and refund foundations.

**Exit criteria:** A real test/live-mode transaction is reconciled correctly; duplicate/out-of-order webhooks do not duplicate payments or corrupt balances.

### M5 — Receivables and collections

Build aging, collection owner/status, promises to pay, disputes, configurable reminder sequences, pause/resume, escalation, communication preferences, partial-payment-aware reminders, and audit history.

**Exit criteria:** Reminders stop or adjust correctly after payment, voiding, pause, or relevant dispute/arrangement state.

### M6 — Momentum AI

Build grounded lead summaries, next-action suggestions, follow-up drafting, quote assistance, and collections drafting with human approval and usage controls.

**Exit criteria:** AI output is helpful, grounded in authorized records, editable, and cannot independently invent financial facts or send external communications without configured approval.

### M7 — Global pilot readiness

Complete responsive UX, onboarding, business branding, data import/export, transactional email templates, accessibility review, security review, backups/recovery drill, monitoring, terms/privacy disclosures, and support/runbooks.

Pilot with businesses in more than one market and test transactions/documents across multiple currencies before declaring global readiness.

---

## 16. Testing strategy

### Financial calculations

Test:

- Quantity × unit price
- Fixed and percentage discounts
- Inclusive and exclusive taxes
- Rounding at line and document level
- Zero-decimal and three-decimal currency cases
- Partial payments
- Overpayments and allocation rules
- Refunds
- Outstanding balance after each allocation
- Foreign-currency snapshots and base-currency reporting
- Invoice totals remaining unchanged after catalogue/rate updates

### State and integration tests

Test:

- Quote acceptance/rejection and revisions
- Quote-to-invoice conversion exactly once
- Duplicate/out-of-order webhook delivery
- Provider timeout and retry
- Failed/pending payment
- Full and partial payment
- Invoice due/overdue transitions
- Reminder pause/stop rules
- Email delivery failure and retry
- Permission denial for sensitive actions
- Cross-tenant data isolation

### End-to-end acceptance scenarios

1. Create lead → qualify → create quote → customer accepts → invoice is generated.
2. Customer pays full invoice → trusted webhook reconciles payment → invoice becomes paid.
3. Customer pays part of invoice → balance is correct → reminders refer only to remaining amount.
4. Invoice becomes overdue → configured reminder is sent → customer pays → future reminders stop.
5. A company with GBP base currency issues USD and EUR invoices → original amounts remain intact and reports clearly show converted totals only where valid rate snapshots exist.
6. User from Organization A attempts to access Organization B's lead, quote, invoice, payment, and public token data → access is denied.
7. Duplicate webhook is delivered several times → exactly one financial effect is recorded.

---

## 17. Product analytics

Instrument key events, with privacy-conscious payloads:

- `lead_created`
- `lead_qualified`
- `opportunity_won`
- `quote_created`
- `quote_sent`
- `quote_viewed`
- `quote_accepted`
- `invoice_created`
- `invoice_sent`
- `invoice_viewed`
- `payment_started`
- `payment_completed`
- `invoice_overdue`
- `reminder_sent`
- `overdue_invoice_paid`

Metrics:

- Lead-to-quote conversion
- Quote acceptance rate
- Quote-to-payment conversion
- Average time from lead to quote
- Average time to payment
- Outstanding receivables by currency and reporting basis
- Reminder delivery and response rates
- Payments collected after reminders, with attribution limitations clearly documented

---

## 18. First implementation sprint

Recommended order:

1. Confirm repository name and create repository.
2. Confirm current stable framework/runtime versions and bootstrap the app.
3. Configure database and typed data layer.
4. Add lint, type-check, unit-test, and CI workflows.
5. Implement authentication and organization/membership models.
6. Implement tenant authorization and cross-tenant tests.
7. Implement global organization settings.
8. Build the authenticated app shell and onboarding.
9. Add audit logging and error monitoring foundations.
10. Deploy a secure skeleton to `momentumdesk.app`.
11. Start M1 with customers, leads, and pipeline.

Do not build the full product in one giant coding prompt. Work milestone by milestone, review the actual repository state, run tests, and deploy incrementally.

---

## 19. Decisions that must be resolved before or during implementation

Do not silently guess at these:

1. Repository name and visibility.
2. Authentication provider and email/password vs. magic-link support.
3. Exact database hosting and backup strategy.
4. Payment providers for the first pilot markets.
5. Initial transactional email provider.
6. Background job/queue service.
7. Currency/decimal library and rounding policy.
8. Per-currency catalogue pricing vs. manual quote line items for V1.
9. Tax handling boundaries for the first pilot markets.
10. Quote acceptance evidence and whether any e-signature provider is required.
11. Public quote/invoice token expiration and revocation policy.
12. AI provider, data handling, and usage limits.

These should be resolved through brief research and explicit decisions, not hidden inside implementation assumptions.

---

## 20. Non-negotiable engineering principles

1. **Global-first:** Never hard-code Nigeria-specific assumptions into shared product logic.
2. **Multi-currency by design:** Currency is explicit and immutable on issued financial documents.
3. **Financial correctness over convenience:** Use decimal-safe arithmetic, documented rounding, and auditable payment allocation.
4. **Tenant isolation:** Every organization-owned resource is authorized server-side.
5. **Reliable automation:** Jobs and webhooks are idempotent, retry-safe, and observable.
6. **Human-controlled AI:** Initial AI drafts and recommends; people approve external communication.
7. **Competitor-informed, not competitor-cloned:** Benchmark standards and friction, then build a coherent MomentumDesk workflow.
8. **Ship in milestones:** Do not claim features are complete until tests and real workflow acceptance criteria pass.
9. **No fabricated status:** Repository, deployment, integration, and test claims must be verified from actual tool output.
10. **Own the lead-to-collected-revenue workflow:** Avoid expanding into unrelated software categories before the core journey works reliably.

---

## 21. Research and official documentation starting points

Use official product documentation for feature verification, and check current regional/plan constraints during each benchmark.

- HubSpot quotes: https://knowledge.hubspot.com/quotes/create-and-send-quotes
- Pipedrive: https://www.pipedrive.com/
- Zoho Books: https://www.zoho.com/books/
- QuickBooks: https://quickbooks.intuit.com/
- Xero: https://www.xero.com/
- FreshBooks: https://www.freshbooks.com/
- HighLevel: https://www.gohighlevel.com/
- Stripe documentation: https://docs.stripe.com/
- Paystack documentation: https://paystack.com/docs/
- Flutterwave documentation: https://developer.flutterwave.com/
- BILL: https://www.bill.com/
- Chaser: https://www.chaserhq.com/

---

## 22. Definition of MVP success

MomentumDesk is ready for a meaningful pilot when a real business can complete this entire flow:

**Real lead captured → opportunity tracked → quote sent in the correct currency → quote accepted → invoice issued → payment received or recorded → balance reconciled → overdue reminders handled correctly.**

It must also pass cross-tenant security tests, financial calculation tests, and multi-currency acceptance scenarios.

The first goal is not to build the largest platform. It is to make this end-to-end revenue workflow reliable, easy to adopt, and valuable enough that a business will pay for it.
