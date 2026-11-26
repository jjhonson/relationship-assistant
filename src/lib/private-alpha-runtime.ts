import "server-only";
import { getDatasetMode, requirePersonalDatasetProfile } from "../../scripts/dataset-profile.mjs";

/**
 * Manual personal-alpha actions may run in the explicitly enabled private
 * Codespaces production build. This is not application-level authentication.
 * The owner-only private tunnel remains mandatory. Gmail/discovery and
 * benchmark actions retain their independent development-only restrictions.
 */
export function requirePrivateAlphaRuntime(env: NodeJS.ProcessEnv = process.env): void {
  const mode = getDatasetMode(env);
  if (env.NODE_ENV === "development" && mode === "fictional") return;
  if (env.NODE_ENV === "production" && mode === "personal" && env.CODESPACES === "true") {
    requirePersonalDatasetProfile(env);
    return;
  }
  throw new Error("Manual capture is available only in fictional development or the explicitly configured private personal alpha.");
}
