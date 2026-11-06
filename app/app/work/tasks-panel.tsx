"use client";

import Link from "next/link";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import type { Parent } from "@/lib/records/parent";
import { createTaskAction, type FormState, removeTaskAction, setTaskCompletedAction } from "./actions";

export interface TaskItem {
  id: string;
  title: string;
  due: string | null;
  overdue: boolean;
  assigneeName: string | null;
  completed: boolean;
  completedNote: string | null;
  record: { label: string; href: string } | null;
  canWrite: boolean;
}

export function NewTaskForm({
  parent,
  members,
  defaultAssignee,
}: {
  parent: Parent | null;
  members: { userId: string; name: string }[];
  defaultAssignee: string;
}) {
  const [formKey, setFormKey] = useState(0);
  const [state, formAction, pending] = useActionState(async (previous: FormState, form: FormData) => {
    const result = await createTaskAction(parent, previous, form);
    if (result.status === "saved") setFormKey((key) => key + 1);
    return result;
  }, { status: "idle" });
  const errors = state.status === "error" ? (state.fields ?? {}) : {};
  return (
    <form key={formKey} action={formAction} className="task-form" aria-label="Add a task">
      {state.status === "error" ? <p role="alert" className="settings-message error">{state.message}</p> : null}
      <fieldset disabled={pending}>
        <input name="title" required maxLength={200} placeholder="What needs doing?" aria-label="Task" />
        <input name="dueOn" type="date" aria-label="Due date" />
        <select name="assigneeUserId" defaultValue={defaultAssignee} aria-label="Assignee">
          <option value="">Unassigned</option>
          {members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
        </select>
        <button type="submit" className="new-button">{pending ? "Adding…" : "Add task"}</button>
      </fieldset>
      {errors.title ? <em role="alert" className="inline-error">{`Task ${errors.title}`}</em> : null}
      {errors.dueOn ? <em role="alert" className="inline-error">{`Due date ${errors.dueOn}`}</em> : null}
    </form>
  );
}

export function TaskList({ tasks, empty }: { tasks: TaskItem[]; empty: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  // Ticking a box shows at once; it reverts if the server refuses.
  const [shown, toggle] = useOptimistic(tasks, (current, id: string) =>
    current.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)),
  );
  const run = (work: () => Promise<FormState>) =>
    start(async () => {
      const result = await work();
      setError(result.status === "error" ? result.message : "");
    });
  return (
    <>
      {error ? <p role="alert" className="settings-message error">{error}</p> : null}
      {shown.length === 0 ? <p className="team-empty">{empty}</p> : null}
      <ul className="task-list">
        {shown.map((task) => (
          <li key={task.id} className={task.completed ? "done" : undefined}>
            <label className="check">
              <input
                type="checkbox"
                checked={task.completed}
                disabled={!task.canWrite || pending}
                onChange={() =>
                  start(async () => {
                    toggle(task.id);
                    const result = await setTaskCompletedAction(task.id, !task.completed);
                    setError(result.status === "error" ? result.message : "");
                  })
                }
                aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
              />
              <span>
                <strong>{task.title}</strong>
                <small>
                  {[
                    task.due ? (task.overdue ? `Overdue · ${task.due}` : `Due ${task.due}`) : null,
                    task.assigneeName ?? "Unassigned",
                    task.completedNote,
                  ].filter(Boolean).join(" · ")}
                  {task.record ? <> · <Link href={task.record.href}>{task.record.label}</Link></> : null}
                </small>
              </span>
            </label>
            {task.canWrite ? (
              <button
                type="button"
                className="link-button danger"
                disabled={pending}
                onClick={() => run(async () => (window.confirm(`Remove “${task.title}”?`) ? removeTaskAction(task.id) : { status: "idle" }))}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
