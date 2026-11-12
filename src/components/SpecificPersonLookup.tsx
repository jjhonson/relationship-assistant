"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { lookupPilotAliases } from "@/app/real-pilot/actions";
import { saveDiscoveredRelationship } from "@/app/relationships/actions";
import type {
  RelationshipContextValue,
  RelationshipRoleValue,
} from "@/lib/inference-benchmark";
import type { AliasCandidate } from "@/lib/real-contact-pilot";

const contextOptions: RelationshipContextValue[] = [
  "Personal relationship",
  "Family",
  "Current coworker",
  "Former colleague",
  "Recruiter",
  "Service provider",
  "Professional contact",
];

const roleOptions: RelationshipRoleValue[] = [
  "Friend",
  "Mentor",
  "Mentee",
  "Advisor",
  "Sponsor",
  "Peer",
  "Collaborator",
];

export function SpecificPersonLookup() {
  const [personLabel, setPersonLabel] = useState("");
  const [resolvedLabel, setResolvedLabel] = useState("");
  const [aliases, setAliases] = useState<AliasCandidate[]>([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [contexts, setContexts] = useState<RelationshipContextValue[]>([]);
  const [roles, setRoles] = useState<RelationshipRoleValue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; id: string; existing: boolean }
    | { kind: "error" }
  >({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function resetSelection() {
    setSelectedAddress("");
    setContexts([]);
    setRoles([]);
    setSaveState({ kind: "idle" });
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setAliases([]);
    setTruncated(false);
    resetSelection();

    startTransition(() => {
      void lookupPilotAliases(personLabel).then((result) => {
        if (result.kind === "error") {
          setMessage(result.message);
          return;
        }
        setResolvedLabel(result.personLabel);
        setAliases(result.candidates);
        setTruncated(result.truncated);
        if (result.candidates.length === 0) {
          setMessage("No matching email identities were found in this bounded Gmail metadata lookup.");
        }
      });
    });
  }

  function toggleContext(value: RelationshipContextValue) {
    setContexts((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function toggleRole(value: RelationshipRoleValue) {
    setRoles((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  async function save() {
    const selected = aliases.find((candidate) => candidate.address === selectedAddress);
    if (!selected) return;

    setSaveState({ kind: "saving" });
    setMessage(null);
    try {
      const result = await saveDiscoveredRelationship(
        {
          address: selected.address,
          name: resolvedLabel,
          sent: 0,
          received: 0,
          threads: 0,
          dates: 0,
          lastExchange: null,
          uncertainty: "Possible",
          reasons: [
            `User-directed Gmail metadata lookup found ${selected.observedMessageCount} matching message${selected.observedMessageCount === 1 ? "" : "s"}.`,
            "You explicitly confirmed this email identity for the person you searched for.",
          ],
        },
        contexts,
        roles,
      );
      setSaveState({ kind: "saved", id: result.id, existing: result.existing });
    } catch {
      setSaveState({ kind: "error" });
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-xl font-semibold">Looking for someone specific?</h2>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          The shortlist helps you discover people. If you already know who you want to add, search Gmail sender/recipient metadata by name instead. Message bodies are not read.
        </p>
      </div>

      <form onSubmit={search} className="mt-4 flex max-w-xl gap-3">
        <label htmlFor="specific-person" className="sr-only">Person name</label>
        <input
          id="specific-person"
          value={personLabel}
          onChange={(event) => setPersonLabel(event.target.value)}
          placeholder="e.g. Mike Curtis"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={isPending || !personLabel.trim()}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Searching…" : "Find in Gmail"}
        </button>
      </form>

      {aliases.length > 0 && (
        <div className="mt-5 border-t border-stone-200 pt-5">
          <p className="font-medium text-stone-900">Confirm the email identity for {resolvedLabel}</p>
          <p className="mt-1 text-sm text-stone-600">
            Choose only an address you recognize as belonging to this person. This lookup does not merge aliases automatically.
          </p>

          <div className="mt-3 space-y-2">
            {aliases.map((candidate) => (
              <label
                key={candidate.address}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3"
              >
                <input
                  type="radio"
                  name="specific-person-address"
                  value={candidate.address}
                  checked={selectedAddress === candidate.address}
                  onChange={() => {
                    setSelectedAddress(candidate.address);
                    setSaveState({ kind: "idle" });
                  }}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{candidate.displayName || resolvedLabel}</span>
                  <span className="block break-all text-sm text-stone-600">{candidate.address}</span>
                  <span className="mt-1 block text-xs text-stone-500">
                    Seen in {candidate.observedMessageCount} matching metadata message{candidate.observedMessageCount === 1 ? "" : "s"}.
                  </span>
                </span>
              </label>
            ))}
          </div>

          {truncated && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              This bounded lookup hit its limit, so there may be additional addresses not shown.
            </p>
          )}

          {selectedAddress && (
            <div className="mt-5 border-t border-stone-200 pt-5">
              <p className="font-medium text-stone-900">Anything obvious about the relationship?</p>
              <p className="mt-1 text-sm text-stone-600">
                Optional. Choose every label that clearly fits. The relationship can be both personal and professional.
              </p>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Contexts</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {contextOptions.map((value) => (
                    <TogglePill
                      key={value}
                      label={value}
                      pressed={contexts.includes(value)}
                      onClick={() => toggleContext(value)}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Roles</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {roleOptions.map((value) => (
                    <TogglePill
                      key={value}
                      label={value}
                      pressed={roles.includes(value)}
                      onClick={() => toggleRole(value)}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {saveState.kind === "saved" ? (
                  <>
                    <Link
                      href={"/relationships/" + saveState.id}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
                    >
                      Open relationship
                    </Link>
                    <span className="text-sm text-stone-600">
                      {saveState.existing ? "Already in relationship memory." : "Saved to relationship memory."}
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={save}
                    disabled={saveState.kind === "saving"}
                    className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    {saveState.kind === "saving" ? "Saving…" : "Save relationship"}
                  </button>
                )}
                {saveState.kind === "error" && (
                  <span className="text-sm text-red-700">Could not save this relationship. Try again.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {message && (
        <p role="status" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
          {message}
        </p>
      )}
    </section>
  );
}

function TogglePill({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm ${
        pressed
          ? "border-indigo-700 bg-indigo-700 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"
      }`}
    >
      {label}
    </button>
  );
}
