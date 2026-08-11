export class MemoryError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details = undefined) {
  if (!condition) throw new MemoryError(code, message, details);
}
