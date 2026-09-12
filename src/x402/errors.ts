export class X402Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "X402Error";
  }
}

export function toSafeError(error: unknown): { code: string; message: string } {
  if (error instanceof X402Error) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "X402_REQUEST_FAILED",
    message: "La solicitud x402 no pudo completarse.",
  };
}
