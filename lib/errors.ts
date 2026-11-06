/** Errors shared by domain services; server actions turn them into form messages. */

export class RecordNotFoundError extends Error {
  constructor(what = "Record") {
    // Same message for missing and other-workspace records.
    super(`${what} not found`);
    this.name = "RecordNotFoundError";
  }
}

export class RecordConflictError extends Error {
  constructor(what = "This record") {
    super(`${what} was changed by someone else. Reload and try again.`);
    this.name = "RecordConflictError";
  }
}

export class InputValidationError extends Error {
  /** Field name → message. Messages never repeat the submitted value. */
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super(`Invalid input: ${Object.keys(fields).join(", ")}`);
    this.name = "InputValidationError";
  }
}
