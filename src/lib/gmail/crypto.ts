import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = (secret: string) => createHash("sha256").update(secret).digest();

export function seal(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

/** Returns null if tampered with or wrong secret. */
export function unseal(sealed: string, secret: string): string | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(sealed)) return null;
    const buf = Buffer.from(sealed, "base64url");
    if (buf.toString("base64url") !== sealed) return null;
    if (buf.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(secret), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
