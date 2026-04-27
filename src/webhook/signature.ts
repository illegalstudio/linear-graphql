import { createHmac, timingSafeEqual } from "node:crypto";

export function computeLinearSignature(rawBody: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyLinearSignature(rawBody: string | Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = computeLinearSignature(rawBody, secret);
  const provided = signatureHeader.trim().replace(/^sha256=/i, "");

  if (!/^[a-f0-9]+$/i.test(provided)) return false;

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
