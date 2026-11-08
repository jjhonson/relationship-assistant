"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  analyzePilotConsent,
  lookupPilotAliases,
  lookupPilotThreads,
  preparePilotAnalysis,
  type PilotAnalysisResult,
  type PilotConsentResult,
} from "@/app/real-pilot/actions";
import {
  MAX_REAL_PILOT_CONVERSATIONS,
  type AliasCandidate,
  type ThreadCandidate,
} from "@/lib/real-contact-pilot";
import { RealRelationshipBrief } from "@/components/RealRelationshipBrief";

type ReadyConsent = Extract<PilotConsentResult, { kind: "ready" }>;
type ReadyAnalysis = Extract<PilotAnalysisResult, { kind: "ready" }>;

export function RealContactPilot() {
  const [personLabel, setPersonLabel] = useState("");
  const [resolvedLabel, setResolvedLabel] = useState("");
  const [aliases, setAliases] = useState<AliasCandidate[]>([]);
  const [selectedAliases, setSelectedAliases] = useState<string[]>([]);
  const [aliasTruncated, setAliasTruncated] = useState(false);
  const [threads, setThreads] = useState<ThreadCandidate[]>([]);
  const [selectedThreads, setSelectedThreads] = useState<string[]>([]);
  const [threadTruncated, setThreadTruncated] = useState(false);
  const [consent, setConsent] = useState<ReadyConsent | null>(null);
  const [analysis, setAnalysis] = useState<ReadyAnalysis | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const clearAnalysis = () => {
    setConsent(null);
    setAnalysis(null);
  };

  const findAliases = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setThreads([]);
    setSelectedThreads([]);
    setSelectedAliases([]);
    clearAnalysis();

    startTransition(() => {
      void lookupPilotAliases(personLabel).then((result) => {
        if (result.kind === "error") {
          setAliases([]);
          setMessage(result.message);
          return;
        }
        setResolvedLabel(result.personLabel);
        setAliases(result.candidates);
        setAliasTruncated(result.truncated);
        if (result.candidates.length === 0) {
          setMessage("No matching email addresses were found in this bounded metadata search.");
        }
      });
    });
  };

  const findThreads = () => {
    setMessage(null);
    setThreads([]);
    setSelectedThreads([]);
    clearAnalysis();

    startTransition(() => {
      void lookupPilotThreads(resolvedLabel, selectedAliases).then((result) => {
        if (result.kind === "error") {
          setMessage(result.message);
          return;
        }
        setThreads(result.candidates);
        setThreadTruncated(result.truncated);
        if (result.candidates.length === 0) {
          setMessage("No candidate threads were found for the confirmed addresses in this bounded search.");
        }
      });
    });
  };

  const toggleAlias = (address: string) => {
    setThreads([]);
    setSelectedThreads([]);
    setMessage(null);
    clearAnalysis();
    setSelectedAliases((current) =>
      current.includes(address)
        ? current.filter((item) => item !== address)
        : [...current, address],
    );
  };

  const toggleThread = (id: string) => {
    setMessage(null);
    clearAnalysis();
    setSelectedThreads((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_REAL_PILOT_CONVERSATIONS) return current;
      return [...current, id];
    });
  };

  const reviewAnalysis = () => {
    if (selectedThreads.length === 0) {
      setMessage("Select at least one thread first.");
      return;
    }

    setMessage(null);
    setConsent(null);
    setAnalysis(null);
    startTransition(() => {
      void preparePilotAnalysis(resolvedLabel, selectedAliases, selectedThreads).then((result) => {
        if (result.kind === "error") {
          setMessage(result.message);
          return;
        }
        setConsent(result);
      });
    });
  };

  const approveAndAnalyze = () => {
    if (!consent) return;
    setMessage(null);
    setAnalysis(null);
    startTransition(() => {
      void analyzePilotConsent(consent.token).then((result) => {
        if (result.kind === "error") {
          setMessage(result.message);
          return;
        }
        setAnalysis(result);
      });
    });
  };

  const selectedThreadSummaries = threads.filter((thread) => selectedThreads.includes(thread.id));

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">1. Find a person</h2>
            <p className="mt-1 text-sm text-stone-600">
              Gmail searches only From, To and Cc metadata for the name you enter. Message bodies and snippets are not requested.
            </p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
            Metadata only
          </span>
        </div>

        <form onSubmit={findAliases} className="mt-5 flex max-w-xl gap-3">
          <label className="sr-only" htmlFor="pilot-person">Person name</label>
          <input
            id="pilot-person"
            value={personLabel}
            onChange={(event) => setPersonLabel(event.target.value)}
            placeholder="e.g. Kate Buggeln"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2"
          />
          <button
            type="submit"
            disabled={isPending || !personLabel.trim()}
            className="rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Searching…" : "Find addresses"}
          </button>
        </form>
      </section>

      {aliases.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white p-6">
          <h2 className="text-xl font-semibold">2. Confirm email identities</h2>
          <p className="mt-1 text-sm text-stone-600">
            These addresses are suggestions, not automatic merges. Check only the addresses you know belong to {resolvedLabel}.
          </p>

          <div className="mt-5 space-y-3">
            {aliases.map((candidate) => (
              <label
                key={candidate.address}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-4"
              >
                <input
                  type="checkbox"
                  checked={selectedAliases.includes(candidate.address)}
                  onChange={() => toggleAlias(candidate.address)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {candidate.displayName || candidate.address}
                  </span>
                  <span className="block break-all text-sm text-stone-600">
                    {candidate.address}
                  </span>
                  <span className="mt-1 block text-xs text-stone-500">
                    Seen in {candidate.observedMessageCount} matching metadata message{candidate.observedMessageCount === 1 ? "" : "s"}.
                  </span>
                </span>
              </label>
            ))}
          </div>

          {aliasTruncated && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              This bounded lookup hit its limit, so there may be additional addresses not shown.
            </p>
          )}

          <button
            type="button"
            onClick={findThreads}
            disabled={isPending || selectedAliases.length === 0}
            className="mt-5 rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Confirm aliases and find threads
          </button>
        </section>
      )}

      {threads.length > 0 && (
        <section className="rounded-2xl border border-stone-200 bg-white p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">3. Select candidate conversations</h2>
              <p className="mt-1 text-sm text-stone-600">
                Select up to {MAX_REAL_PILOT_CONVERSATIONS}. These summaries come only from headers and Gmail message metadata.
              </p>
            </div>
            <span className="text-sm font-medium text-stone-700">
              {selectedThreads.length}/{MAX_REAL_PILOT_CONVERSATIONS} selected
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {threads.map((thread) => {
              const checked = selectedThreads.includes(thread.id);
              const disabled = !checked && selectedThreads.length >= MAX_REAL_PILOT_CONVERSATIONS;
              const matchedAliases = thread.participantAddresses.filter((address) =>
                selectedAliases.includes(address),
              );
              return (
                <label
                  key={thread.id}
                  className={\`flex items-start gap-3 rounded-xl border border-stone-200 p-4 \${disabled ? "opacity-50" : "cursor-pointer"}\`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleThread(thread.id)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{thread.subject}</span>
                    <span className="mt-1 block text-sm text-stone-600">
                      {thread.firstDate === thread.lastDate
                        ? thread.lastDate
                        : \`\${thread.firstDate} to \${thread.lastDate}\`} · {thread.messageCount} matching message{thread.messageCount === 1 ? "" : "s"}
                    </span>
                    <span className="mt-1 block break-all text-xs text-stone-500">
                      Confirmed address{matchedAliases.length === 1 ? "" : "es"}: {matchedAliases.join(", ")}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {threadTruncated && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              This bounded search hit its limit. The list is intentionally incomplete for the pilot.
            </p>
          )}

          <button
            type="button"
            onClick={reviewAnalysis}
            disabled={isPending || selectedThreads.length === 0}
            className="mt-5 rounded-lg border border-indigo-700 px-4 py-2 font-medium text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Review analysis disclosure
          </button>
          <p className="mt-2 text-xs text-stone-500">
            This does not read message bodies. The server first revalidates the exact selected conversation IDs.
          </p>
        </section>
      )}

      {consent && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-xl font-semibold">4. Review and approve analysis</h2>
          <p className="mt-2 text-sm text-stone-700">
            Your approval is bound to the current Gmail connection and exactly {consent.disclosure.selectedConversationIds.length} selected
            thread{consent.disclosure.selectedConversationIds.length === 1 ? "" : "s"}. It expires at{" "}
            {new Date(consent.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>

          <div className="mt-4 rounded-xl bg-white p-4 text-sm text-stone-700">
            <p className="font-medium">If you approve, the app will:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Read sender/recipient, date, subject, and message text only from the selected conversations.</li>
              <li>Ignore attachments and avoid any attachment-download request.</li>
              <li>Minimize common quoted reply history and cap the amount of text processed.</li>
              <li>Send the minimized selected correspondence to OpenAI for relationship inference with API storage disabled.</li>
              <li>Return the brief to this page without saving message bodies to a database, analytics, or GitHub.</li>
            </ul>
          </div>

          <div className="mt-4">
            <p className="text-sm font-medium text-stone-800">Selected Gmail conversations</p>
            <div className="mt-2 space-y-2">
              {selectedThreadSummaries.map((thread) => (
                <div key={thread.id} className="rounded-lg bg-white px-3 py-2 text-sm">
                  <span className="font-medium">{thread.subject}</span>
                  <span className="text-stone-500"> · {thread.firstDate === thread.lastDate ? thread.lastDate : \`\${thread.firstDate} to \${thread.lastDate}\`}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={approveAndAnalyze}
            disabled={isPending}
            className="mt-5 rounded-lg bg-indigo-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Analyzing…" : "Approve and analyze selected conversations"}
          </button>
        </section>
      )}

      {analysis && <RealRelationshipBrief result={analysis} />}

      {message && (
        <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
          {message}
        </p>
      )}
    </div>
  );
}
