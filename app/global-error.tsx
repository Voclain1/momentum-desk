"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort error page when even the root layout fails. Reports the error. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, Helvetica, sans-serif", padding: "48px 16px", textAlign: "center", color: "#172126" }}>
        <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
        <p style={{ color: "#718087" }}>
          The problem has been reported. Try again, or come back in a few minutes.
          {error.digest ? ` Reference: ${error.digest}` : ""}
        </p>
        <button type="button" onClick={reset} style={{ marginTop: 16, padding: "10px 18px", borderRadius: 8, border: 0, background: "#167a62", color: "white", fontWeight: 700 }}>
          Try again
        </button>
      </body>
    </html>
  );
}
