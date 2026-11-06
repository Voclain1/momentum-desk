"use client";

import { useState, useTransition } from "react";
import { moveLeadAction } from "../leads/actions";

/** Moves a lead to another stage from its card. */
export function MoveSelect({
  leadId,
  leadName,
  stageId,
  stages,
}: {
  leadId: string;
  leadName: string;
  stageId: string;
  stages: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <select
        aria-label={`Move ${leadName}`}
        className="move-select"
        value={stageId}
        disabled={pending}
        onChange={(event) =>
          start(async () => {
            const result = await moveLeadAction(leadId, event.target.value);
            setError(result.status === "error" ? result.message : "");
          })
        }
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.id === stageId ? stage.name : `Move to ${stage.name}`}
          </option>
        ))}
      </select>
      {error ? <small role="alert" className="inline-error">{error}</small> : null}
    </>
  );
}
