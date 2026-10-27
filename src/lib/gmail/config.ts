export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const MAX_SAMPLE = 50;

export type GmailConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  sampleSize: number;
};

export function clampSampleSize(raw: string | number | undefined | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return MAX_SAMPLE;
  return Math.min(Math.floor(n), MAX_SAMPLE);
}

/** Returns config, or the names of missing environment variables. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; config: GmailConfig } | { ok: false; missing: string[] } {
  const names = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "SESSION_SECRET"];
  const missing = names.filter((k) => !env[k]);
  if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32 && !missing.includes("SESSION_SECRET")) {
    missing.push("SESSION_SECRET (min 32 chars)");
  }
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    config: {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
      redirectUri: env.GOOGLE_REDIRECT_URI!,
      sessionSecret: env.SESSION_SECRET!,
      sampleSize: clampSampleSize(env.GMAIL_SAMPLE_SIZE),
    },
  };
}
