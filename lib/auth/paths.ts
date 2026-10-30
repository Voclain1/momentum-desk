/** Where an invitee accepts an invitation. Shared by server and browser code. */
export const invitationPath = (invitationId: string) => `/invite/${encodeURIComponent(invitationId)}`;
