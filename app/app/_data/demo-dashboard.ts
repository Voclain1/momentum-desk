import { fromDecimalString, type CurrencyCode, type Money } from "@/lib/money";

/**
 * Static demo data for the dashboard preview. Replaced by tenant-scoped
 * queries once organizations and the CRM/invoice models exist.
 *
 * Every amount is `Money` in the workspace base currency, so the dashboard can
 * state its currency basis instead of implying one.
 */
export const demoWorkspace = {
  name: "Demo workspace",
  initials: "DW",
  role: "Owner",
  baseCurrency: "USD" satisfies CurrencyCode,
  locale: "en-US",
} as const;

const usd = (amount: string): Money => fromDecimalString(amount, demoWorkspace.baseCurrency);

export type Tone = "green" | "amber" | "red" | "blue";

export type Metric = {
  label: string;
  value: Money | number;
  note: string;
  noteAmount?: Money;
  tone: Tone;
};

export const metrics: Metric[] = [
  { label: "Open pipeline", value: usd("184250"), note: "+12.4% this month", tone: "green" },
  {
    label: "Quotes awaiting action",
    value: 14,
    note: "in value",
    noteAmount: usd("47800"),
    tone: "amber",
  },
  { label: "Outstanding invoices", value: usd("31420"), note: "8 invoices overdue", tone: "red" },
  { label: "Collected this month", value: usd("92680"), note: "81% of target", tone: "blue" },
];

export const monthlyTarget = {
  label: "October target",
  collected: usd("114420"),
  target: usd("150000"),
};

export type AttentionKind = "Quote" | "Invoice" | "Opportunity" | "Payment";

export type AttentionItem = {
  company: string;
  reason: string;
  amount: Money;
  action: string;
  kind: AttentionKind;
};

export const attentionItems: AttentionItem[] = [
  {
    company: "Northstar Studio",
    reason: "Quote viewed 3 days ago",
    amount: usd("8400"),
    action: "Follow up",
    kind: "Quote",
  },
  {
    company: "Helio Works",
    reason: "Invoice is 7 days overdue",
    amount: usd("12750"),
    action: "Review chase",
    kind: "Invoice",
  },
  {
    company: "Atlas & Co.",
    reason: "No activity for 5 days",
    amount: usd("24000"),
    action: "Plan next step",
    kind: "Opportunity",
  },
  {
    company: "Koru Systems",
    reason: "Payment failed this morning",
    amount: usd("3200"),
    action: "Resolve",
    kind: "Payment",
  },
];

export type FlowStage = {
  label: string;
  count: number;
  detail: string;
  detailAmount?: Money;
  dot: "indigo" | "purple" | "amber-dot" | "green-dot";
};

export const revenueFlow: FlowStage[] = [
  { label: "New leads", count: 48, detail: "potential", detailAmount: usd("286000"), dot: "indigo" },
  { label: "Qualified", count: 31, detail: "65% conversion", dot: "purple" },
  { label: "Quotes sent", count: 22, detail: "quoted", detailAmount: usd("142000"), dot: "amber-dot" },
  { label: "Won & paid", count: 16, detail: "collected", detailAmount: usd("92680"), dot: "green-dot" },
];

export const leadToCash = { rate: "33.3%", change: "↑ 4.8%" };
