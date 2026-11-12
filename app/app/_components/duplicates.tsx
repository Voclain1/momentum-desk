import Link from "next/link";
import type { Duplicate } from "@/lib/records/duplicates";

const REASONS: Record<Duplicate["reasons"][number], string> = { email: "same email", phone: "same phone", name: "same name" };

/**
 * Possible duplicates of a record (decision D28): shown so people can check,
 * never merged automatically. Only records the member may open are listed.
 */
export function PossibleDuplicates({ duplicates }: { duplicates: Duplicate[] }) {
  if (duplicates.length === 0) return null;
  return (
    <aside className="panel contacts-panel duplicates-panel" aria-label="Possible duplicates">
      <div className="panel-heading">
        <div>
          <h3>Possible duplicates</h3>
          <p>Records that share details with this one. Nothing is merged automatically.</p>
        </div>
      </div>
      <ul className="contact-list">
        {duplicates.map((duplicate) => (
          <li key={`${duplicate.type}-${duplicate.id}`}>
            <div>
              <strong>
                <Link href={`/app/${duplicate.type === "customer" ? "customers" : "leads"}/${duplicate.id}`}>{duplicate.label}</Link>
                <span className="pill">{duplicate.type === "customer" ? "Customer" : "Lead"}</span>
              </strong>
              <small>{duplicate.reasons.map((reason) => REASONS[reason]).join(", ")}</small>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
