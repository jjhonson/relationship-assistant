import type { NextConfig } from "next";

/**
 * Codespaces forwards browser requests through a per-Codespace hostname.
 * Restrict the Server Actions origin allowlist to this exact development
 * Codespace, never all *.app.github.dev hosts (other developers own those).
 */
export function codespaceServerActionOrigins(env: {
  NODE_ENV?: string;
  CODESPACE_NAME?: string;
}): string[] {
  const name = env.CODESPACE_NAME;
  if (env.NODE_ENV !== "development" || !name ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return [];
  return [`${name}-3000.app.github.dev`, "localhost:3000"];
}

const codespaceOrigins = codespaceServerActionOrigins(process.env);
const nextConfig: NextConfig = {
  experimental: {
    // Still bounded by MAX_CAPTURE_IMAGE_BYTES in server-side validation.
    serverActions: {
      bodySizeLimit: "5mb",
      ...(codespaceOrigins.length ? { allowedOrigins: codespaceOrigins } : {}),
    },
  },
};

export default nextConfig;
