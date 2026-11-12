import { csvDownload } from "@/lib/transfer/route";
import { exportCustomers } from "@/lib/transfer/service";

export function GET() {
  return csvDownload("customers:read", "customers", exportCustomers);
}
