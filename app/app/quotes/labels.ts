import type { DisplayStatus } from "@/lib/quotes/service";

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  expired: "Expired",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Superseded",
};
