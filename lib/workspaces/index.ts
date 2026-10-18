import { db } from "@/lib/db";
import { updateWorkspaceSettings as update, type UpdateWorkspaceSettings } from "./settings-service";

export {
  WorkspaceConflictError,
  WorkspaceValidationError,
  type WorkspaceSettingsUpdate,
} from "./settings-service";

/** See lib/workspaces/settings-service.ts. Server-only. */
export function updateWorkspaceSettings(request: UpdateWorkspaceSettings) {
  return update(db, request);
}
