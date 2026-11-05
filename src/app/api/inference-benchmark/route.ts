import { NextResponse } from "next/server";
import { relationshipBenchmarkCases } from "@/lib/inference-benchmark";
import {
  DEFAULT_OPENAI_RELATIONSHIP_MODEL,
  inferRelationshipWithOpenAI,
} from "@/lib/openai-inference";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured in the local server environment.",
        requiredEnvironmentVariable: "OPENAI_API_KEY",
      },
      { status: 400 },
    );
  }

  let body: { caseId?: string; model?: string } = {};
  try {
    body = (await request.json()) as { caseId?: string; model?: string };
  } catch {
    // An empty POST body means run all fictional benchmark cases with the configured/default model.
  }

  const selected = body.caseId
    ? relationshipBenchmarkCases.filter((benchmark) => benchmark.id === body.caseId)
    : relationshipBenchmarkCases;

  if (body.caseId && selected.length === 0) {
    return NextResponse.json(
      {
        error: "Unknown fictional benchmark case.",
        availableCaseIds: relationshipBenchmarkCases.map((benchmark) => benchmark.id),
      },
      { status: 400 },
    );
  }

  const model = body.model || process.env.OPENAI_RELATIONSHIP_MODEL || DEFAULT_OPENAI_RELATIONSHIP_MODEL;
  const results = [];

  for (const benchmark of selected) {
    try {
      const result = await inferRelationshipWithOpenAI(benchmark, { apiKey, model });
      results.push({
        caseId: benchmark.id,
        title: benchmark.title,
        ok: true as const,
        ...result,
      });
    } catch (error) {
      results.push({
        caseId: benchmark.id,
        title: benchmark.title,
        ok: false as const,
        error: error instanceof Error ? error.message : "Unknown inference error.",
      });
    }
  }

  return NextResponse.json({
    provider: "openai",
    requestedModel: model,
    fictionalOnly: true,
    caseCount: selected.length,
    results,
  });
}
