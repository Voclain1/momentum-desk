"use client";

import { useActionState } from "react";
import type { StopState } from "./actions";

export function StopReminders({ action }: { action: () => Promise<StopState> }) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  if (state.status === "done") return <p role="status" className="public-download">You will not get payment reminders from this business.</p>;
  return (
    <form action={formAction} className="public-download">
      {state.status === "error" ? <p role="alert" className="settings-message error">This link no longer works.</p> : null}
      <button type="submit" className="link-button" disabled={pending}>Stop payment reminders</button>
    </form>
  );
}
