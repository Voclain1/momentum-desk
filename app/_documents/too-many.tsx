/** Shown when one address opens public pages too quickly (lib/security/rate-limit.ts). */
export function TooManyRequests({ retryAfter }: { retryAfter: number }) {
  return (
    <main className="public-page">
      <p role="alert" className="settings-message error public-banner">
        Too many requests from your connection. Please wait {retryAfter < 90 ? "a minute" : `${Math.ceil(retryAfter / 60)} minutes`} and try again.
      </p>
    </main>
  );
}
