/** Error thrown when programmatic checker options do not match the public API contract. */
export class InvalidOptionsError extends TypeError {
  constructor(optionPath: string, message: string) {
    super(`Invalid option ${optionPath}: ${message}`);
    this.name = "InvalidOptionsError";
  }
}
