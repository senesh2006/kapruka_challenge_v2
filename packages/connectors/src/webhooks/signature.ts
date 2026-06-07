import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignatureScheme {
  /** Lowercased header name carrying the signature. Default: "x-kapruka-signature". */
  headerName: string;
  /** Optional timestamp header for replay protection. */
  timestampHeader?: string;
  /** Tolerance window (seconds) when timestampHeader is set. Default: 300. */
  timestampToleranceSec: number;
  /** HMAC algorithm. Currently sha256 only. */
  algorithm: "sha256";
  /** Encoding of the signature value in the header. */
  encoding: "hex" | "base64";
}

export const DEFAULT_SIGNATURE_SCHEME: SignatureScheme = {
  headerName: "x-kapruka-signature",
  timestampToleranceSec: 300,
  algorithm: "sha256",
  encoding: "hex",
};

export interface SignatureVerifier {
  verify(rawBody: string, headers: Record<string, string>, secret: string, nowMs?: number): boolean;
}

export class HmacSha256Verifier implements SignatureVerifier {
  constructor(private readonly scheme: SignatureScheme = DEFAULT_SIGNATURE_SCHEME) {}

  verify(
    rawBody: string,
    headers: Record<string, string>,
    secret: string,
    nowMs: number = Date.now(),
  ): boolean {
    const lowered = lowercaseKeys(headers);
    const provided = lowered[this.scheme.headerName];
    if (!provided) return false;

    if (this.scheme.timestampHeader) {
      const ts = lowered[this.scheme.timestampHeader];
      if (!ts) return false;
      const tsSec = Number(ts);
      if (!Number.isFinite(tsSec)) return false;
      const driftSec = Math.abs(nowMs / 1000 - tsSec);
      if (driftSec > this.scheme.timestampToleranceSec) return false;
    }

    const expected = createHmac(this.scheme.algorithm, secret)
      .update(rawBody, "utf8")
      .digest(this.scheme.encoding);

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(headers)) {
    const v = headers[k];
    if (v !== undefined) out[k.toLowerCase()] = v;
  }
  return out;
}
