import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RealContactPilot } from "@/components/RealContactPilot";
import { loadConfig } from "@/lib/gmail/config";
import { CRED_COOKIE, credentialPageAction, readCreds } from "@/lib/gmail/session";

export const dynamic = "force-dynamic";

export default async function RealPilotPage() {
  if (process.env.NODE_ENV !== "development") {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Real-contact pilot</h1>
        <p className="mt-4 rounded-xl bg-amber-100 p-4 text-amber-950">
          This pilot is intentionally available only in local development.
        </p>
      </div>
    );
  }

  const cfg = loadConfig();
  const store = await cookies();
  const creds = cfg.ok ? readCreds(store.get(CRED_COOKIE)?.value, cfg.config.sessionSecret) : null;
  const action = credentialPageAction(creds);

  if (action === "refresh") {
    redirect("/api/gmail/refresh?returnTo=%2Freal-pilot");
  }

  if (!cfg.ok || !creds) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Real-contact pilot</h1>
        <p className="mt-2 text-stone-600">
          Select one real person, confirm their email identities, and review candidate Gmail threads using metadata only.
        </p>
        <p role="status" className="mt-5 rounded-xl bg-amber-100 p-4 text-amber-950">
          {cfg.ok
            ? "Gmail is not connected. Connect it from the Gmail proof-of-concept page, then return here."
            : "Gmail is not configured. See the README for local setup details."}
        </p>
        {cfg.ok && (
          <a
            href="/gmail"
            className="mt-4 inline-block rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white"
          >
            Open Gmail connection
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Real-contact pilot</h1>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            Local development only
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-stone-600">
          Test identity resolution and thread selection on one person you know well. This stage reads Gmail headers and metadata only.
          It does not retrieve message bodies, attachments or snippets, and it does not call OpenAI.
        </p>
      </header>

      <RealContactPilot />

      <form action="/api/gmail/disconnect" method="post">
        <button className="rounded-lg border border-stone-300 px-4 py-2">
          Disconnect Gmail
        </button>
      </form>
    </div>
  );
}
