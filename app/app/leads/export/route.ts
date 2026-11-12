import { csvDownload } from "@/lib/transfer/route";
import { exportLeads } from "@/lib/transfer/service";

export function GET() {
  return csvDownload("sales:read", "leads", exportLeads);
}
