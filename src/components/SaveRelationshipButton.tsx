"use client";

import { useState } from "react";
import Link from "next/link";
import type { PilotAnalysisResult } from "@/app/real-pilot/actions";
import { savePilotRelationship } from "@/app/relationships/actions";

type ReadyPilotAnalysis = Extract<PilotAnalysisResult, { kind: "ready" }>;

export function SaveRelationshipButton({ result }: { result: ReadyPilotAnalysis }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved"; id: string }
    | { kind: "error" }
  >({ kind: "idle" });

  async function save() {
    setState({ kind: "saving" });
    try {
      const saved = await savePilotRelationship(result);
      setState({ kind: "saved", id: saved.id });
    } catch {
      setState({ kind: "error" });
    }
  }

  if (state.kind === "saved") {
    return (
      <Link
        href={"/relationships/" + state.id}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
      >
        View saved relationship
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={save}
      disabled={state.kind === "saving"}
      className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:bg-stone-400"
    >
      {state.kind === "idle" && "Save relationship"}
      {state.kind === "saving" && "Saving…"}
      {state.kind === "error" && "Save failed · try again"}
    </button>
  );
}
