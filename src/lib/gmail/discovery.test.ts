import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAddressLookup, fetchDiscoverySample, fetchHistoricalMessages, fetchOwnerAddress, type DiscoveryMessage } from "./messages";
import { analyzeDiscovery, diagnoseAddress, rankCandidates } from "./discovery";

afterEach(() => vi.unstubAllGlobals());

function message(
  id: string,
  from: string,
  to: string,
  date: string,
  extraHeaders: { name: string; value: string }[] = [],
  sent = false,
): DiscoveryMessage {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: String(Date.parse(date)),
    labelIds: sent ? ["SENT"] : ["INBOX"],
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Date", value: date },
        ...extraHeaders,
      ],
    },
  };
}

describe("relationship discovery ranking", () => {
  const owner = "Owner <owner@example.test>";
  const out = (id: string, to: string, extra: { name: string; value: string }[] = []) =>
    message(id, owner, to, "Mon, 01 Jan 2024 10:00:00 +0000", extra, true);
  const inc = (id: string, to: string, from = "Alex <alex@example.test>") =>
    message(id, from, to, "Tue, 02 Jan 2024 10:00:00 +0000");

  it("treats mixed bare and named multi-recipient headers as group mail", () => {
    const header = 'first@example.test, "Person, Second" <second@example.test>';
    expect(rankCandidates([out("o", header), inc("i", header)])).toEqual([]);
  });

  it("preserves quoted commas in a single display name", () => {
    const [candidate] = rankCandidates([out("o", '"Morgan, Alex" <alex@example.test>')]);
    expect(candidate).toMatchObject({ address: "alex@example.test", name: "Morgan, Alex" });
  });

  it("excludes Auto-Submitted values with parameters but allows no", () => {
    const auto = { name: "Auto-Submitted", value: 'auto-generated; owner-email="service@example.test"' };
    expect(rankCandidates([inc("a", owner, "Pat <pat@example.test>")].map((m) => ({ ...m, payload: { headers: [...(m.payload?.headers ?? []), auto] } })))).toEqual([]);
    const no = { name: "Auto-Submitted", value: "no" };
    expect(rankCandidates([out("n", "Pat <pat@example.test>", [no])])).toHaveLength(1);
  });

  it("ignores drafts when determining self addresses and aggregating", () => {
    const draft = { ...inc("d", "Alex <alex@example.test>", owner), labelIds: ["DRAFT"] };
    expect(rankCandidates([draft, out("i", "Alex <alex@example.test>")]).map((c) => c.address)).toEqual(["alex@example.test"]);
    expect(rankCandidates([draft])).toEqual([]);
  });

  it("does not count incoming or outgoing group messages as direct correspondence", () => {
    const groupIn = inc("gi", "Owner <owner@example.test>, Sam <sam@example.test>");
    const groupOut = out("go", "Alex <alex@example.test>, Sam <sam@example.test>");
    const ccOut = out("co", "Alex <alex@example.test>", [{ name: "Cc", value: "Sam <sam@example.test>" }]);
    expect(rankCandidates([out("self", "Owner <owner@example.test>"), groupIn, groupOut, ccOut])).toEqual([]);
  });

  it("skips messages with unparseable address headers", () => {
    expect(rankCandidates([out("o", "undisclosed-recipients:;"), out("p", "not an address")])).toEqual([]);
  });

  it("prioritizes direct correspondence and excludes mailing lists and automated senders", () => {
    const candidates = rankCandidates([
      message("out", "Owner <owner@example.test>", "Alex Morgan <alex@example.test>", "Mon, 01 Jan 2024 10:00:00 +0000", [], true),
      message("in", "Alex Morgan <alex@example.test>", "Owner <owner@example.test>", "Tue, 02 Jan 2024 10:00:00 +0000"),
      message("newsletter", "Weekly Update <news@example.test>", "Owner <owner@example.test>", "Wed, 03 Jan 2024 10:00:00 +0000", [
        { name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.test>" },
      ]),
      message("automated", "No Reply <no-reply@store.example.test>", "Owner <owner@example.test>", "Thu, 04 Jan 2024 10:00:00 +0000"),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: "Alex Morgan",
      address: "alex@example.test",
      sent: 1,
      received: 1,
      uncertainty: "Repeated correspondence observed",
    });
    expect(candidates[0].reasons.join(" ")).toContain("both sent and received");
  });

  it("does not recommend a lone inbound message but keeps one-way sent contacts as possible", () => {
    const lone = message("recruiter", "Jordan Lee <jordan@careers.example.test>", "Owner <owner@example.test>", "Fri, 05 Jan 2024 10:00:00 +0000");
    expect(rankCandidates([lone])).toEqual([]);

    const [candidate] = rankCandidates([out("o", "Casey <casey@example.test>")]);
    expect(candidate.uncertainty).toBe("Possible");
    expect(candidate.sent).toBe(1);
    expect(candidate.reasons[0]).toContain("no incoming messages were seen in the sample");
  });

  it("does not assert reciprocity from a sparse sample", () => {
    const [candidate] = rankCandidates([out("o", "Casey <casey@example.test>")]);
    expect(candidate.received).toBe(0);
    expect(candidate.uncertainty).not.toBe("Repeated correspondence observed");
    const [two] = rankCandidates([out("o", "Casey <casey@example.test>"), inc("i", "Owner <owner@example.test>", "Casey <casey@example.test>")].map((m) => ({ ...m, threadId: "same" })));
    expect(two.uncertainty).toBe("Two-way exchange observed");
  });

  it("excludes generic store, support and marketing-subdomain senders without List-Unsubscribe", () => {
    const senders = [
      "Shop <store@example.test>",
      "Help <support@example.test>",
      "Deals <hello@e.example.test>",
      "Acme Customer Service <cs@example.test>",
      "Orders <order-confirmation@example.test>",
    ];
    const messages = senders.flatMap((from, i) => [
      message(`a${i}`, from, "Owner <owner@example.test>", "Tue, 02 Jan 2024 10:00:00 +0000"),
      message(`b${i}`, from, "Owner <owner@example.test>", "Wed, 03 Jan 2024 10:00:00 +0000"),
    ]);
    const { candidates, diagnostics } = analyzeDiscovery(messages);
    expect(candidates).toEqual([]);
    expect(diagnostics.excludedAutomated).toBe(10);
  });

  it("keeps a real person on a business domain", () => {
    const messages = [
      out("o", "Riley Chen <riley.chen@acme-corp.example.test>"),
      inc("i", "Owner <owner@example.test>", "Riley Chen <riley.chen@acme-corp.example.test>"),
    ];
    expect(rankCandidates(messages).map((c) => c.address)).toEqual(["riley.chen@acme-corp.example.test"]);
  });

  it("keeps a registrable .co.uk contact and excludes a marketing subdomain", () => {
    const correspondent = [
      out("uk-sent", "Alex <alex@mail.co.uk>"),
      inc("uk-received", "Owner <owner@example.test>", "Alex <alex@mail.co.uk>"),
    ];
    const marketing = [
      inc("marketing-1", "Owner <owner@example.test>", "Alex <alex@news.example.co.uk>"),
      inc("marketing-2", "Owner <owner@example.test>", "Alex <alex@news.example.co.uk>"),
    ];
    const { candidates, diagnostics } = analyzeDiscovery([...correspondent, ...marketing]);

    expect(candidates.map((candidate) => candidate.address)).toEqual(["alex@mail.co.uk"]);
    expect(candidates[0].uncertainty).toBe("Repeated correspondence observed");
    expect(diagnostics.excludedAutomated).toBe(2);
  });

  it("counts viable candidates before applying the ten-candidate display cap", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      out(`contact-${i}`, `Person ${i} <person${i}@example.test>`),
    );
    const { candidates, diagnostics } = analyzeDiscovery(messages);

    expect(candidates).toHaveLength(10);
    expect(diagnostics.candidatesSurviving).toBe(12);
  });

  it("does not let a high-volume marketing sender outrank a modest real correspondent", () => {
    const spam = Array.from({ length: 30 }, (_, i) =>
      message(`m${i}`, "Gadgets Weekly <gadgets@shopco.example.test>", "Owner <owner@example.test>", `Mon, ${String((i % 28) + 1).padStart(2, "0")} Jan 2024 10:00:00 +0000`),
    );
    const real = [out("o", "Sam Park <sam@example.test>")];
    const { candidates, diagnostics } = analyzeDiscovery([...spam, ...real]);
    expect(candidates.map((c) => c.address)).toEqual(["sam@example.test"]);
    expect(diagnostics.excludedOneWayHighVolume).toBe(1);
    expect(diagnostics.sentExamined).toBe(1);
    expect(diagnostics.receivedExamined).toBe(30);
  });
});

describe("historical metadata sampling", () => {
  const NOW = new Date("2025-06-15T00:00:00Z");
  const owner = "Owner <owner@example.test>";
  const T0 = Date.parse("2016-01-01T00:00:00Z");

  type Box = { id: string; date: number; labelIds: string[]; from: string; to: string };

  /** Synthetic mailbox: a 10-year two-way correspondent plus year-end-heavy newsletters. */
  function buildMailbox(): Box[] {
    const box: Box[] = [];
    let n = 0;
    for (let q = 0; q < 38; q++) {
      const date = Date.UTC(2016 + Math.floor(q / 4), (q % 4) * 3 + 1, 10);
      box.push({ id: `s${n++}`, date, labelIds: ["SENT"], from: owner, to: "Dana Wu <dana@example.test>" });
      box.push({ id: `r${n++}`, date: date + 86_400_000, labelIds: ["INBOX"], from: "Dana Wu <dana@example.test>", to: owner });
      box.push({ id: `s${n++}`, date: date + 2 * 86_400_000, labelIds: ["SENT"], from: owner, to: `Friend${q} <friend${q}@example.test>` });
    }
    for (let year = 2016; year <= 2025; year++) {
      for (let i = 0; i < 60; i++) {
        box.push({ id: `n${n++}`, date: Date.UTC(year, 11, 1 + (i % 30)), labelIds: ["INBOX"], from: "Deals <deals@promo.example.test>", to: owner });
      }
    }
    return box.filter((m) => m.date >= T0 && m.date < NOW.getTime());
  }

  function mockGmail(box: Box[], requests: URL[]) {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("/messages")) {
        const q = url.searchParams.get("q") ?? "";
        const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0) * 1000;
        const before = Number(q.match(/before:(\d+)/)?.[1] ?? Infinity) * 1000;
        const from = q.match(/from:(\S+)/)?.[1];
        const sentOnly = q.includes("in:sent") && !q.includes("-in:sent");
        const max = Number(url.searchParams.get("maxResults"));
        const hits = box
          .filter((m) => m.date >= after && m.date < before)
          .filter((m) => !sentOnly || m.labelIds.includes("SENT"))
          .filter((m) => !q.includes("-in:sent") || !m.labelIds.includes("SENT"))
          .filter((m) => !from || m.from.includes(`<${from}>`))
          .sort((a, b) => b.date - a.date)
          .slice(0, max);
        return new Response(JSON.stringify({ messages: hits.map((m) => ({ id: m.id, threadId: `t-${m.id}` })) }), { status: 200 });
      }
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const m = box.find((item) => item.id === id)!;
      return new Response(JSON.stringify({
        id,
        threadId: `t-${id}`,
        internalDate: String(m.date),
        labelIds: m.labelIds,
        payload: { headers: [{ name: "From", value: m.from }, { name: "To", value: m.to }] },
      }), { status: 200 });
    }));
  }

  it("spreads Sent sampling across quarters, stays bounded, and requests metadata headers only", async () => {
    const requests: URL[] = [];
    mockGmail(buildMailbox(), requests);
    const { messages, stats } = await fetchDiscoverySample("fake-token", 100, NOW);
    const details = requests.filter((url) => /\/messages\/[^/]+$/.test(url.pathname));

    expect(messages.length).toBeLessThanOrEqual(160);
    expect(details).toHaveLength(messages.length);
    expect(stats.monthWindowsQueried).toBe(60);
    expect(stats.windowsQueried).toBeGreaterThanOrEqual(60);
    expect(stats.sentBudget).toBe(60);
    const sentMonths = new Set(
      messages.filter((m) => m.labelIds?.includes("SENT")).map((m) => new Date(Number(m.internalDate)).toISOString().slice(0, 7)),
    );
    const sentYears = new Set([...sentMonths].map((month) => month.slice(0, 4)));
    expect(sentYears.size).toBeGreaterThanOrEqual(9);
    expect(sentMonths.size).toBeGreaterThanOrEqual(30);
    expect(details[0].searchParams.get("format")).toBe("metadata");
    expect(details[0].searchParams.getAll("metadataHeaders")).toContain("To");
    expect(details[0].searchParams.get("fields")).not.toContain("body");
    expect(requests.filter((u) => u.pathname.endsWith("/messages")).length).toBeLessThanOrEqual(160);
  });

  it("recovers a multi-year two-way correspondent without naming them and ignores year-end newsletters", async () => {
    mockGmail(buildMailbox(), []);
    const { messages } = await fetchDiscoverySample("fake-token", 200, NOW);
    const { candidates, diagnostics } = analyzeDiscovery(messages);
    expect(candidates[0]).toMatchObject({ address: "dana@example.test", uncertainty: "Repeated correspondence observed" });
    expect(candidates.some((c) => c.address.includes("deals"))).toBe(false);
    expect(diagnostics.distinctMonths).toBeGreaterThan(20);
    expect(diagnostics.sentExamined).toBeGreaterThan(0);
    expect(diagnostics.receivedExamined).toBeGreaterThan(0);
  });

  it("samples a sparse long-running correspondent that newest-per-quarter sampling would miss", async () => {
    // Each quarter: one message to the correspondent early, then six one-off messages in the last month.
    // Taking only the newest three Sent messages per quarter never reaches the early one.
    const box: Box[] = [];
    let n = 0;
    for (let q = 0; q < 36; q++) {
      const year = 2016 + Math.floor(q / 4);
      const first = (q % 4) * 3;
      box.push({ id: `s${n++}`, date: Date.UTC(year, first, 5), labelIds: ["SENT"], from: owner, to: "Riley Fox <riley@example.test>" });
      for (let i = 0; i < 6; i++) {
        box.push({ id: `s${n++}`, date: Date.UTC(year, first + 2, 10 + i), labelIds: ["SENT"], from: owner, to: `One${q}x${i} <one${q}x${i}@example.test>` });
      }
    }
    mockGmail(box, []);
    const { messages, stats } = await fetchDiscoverySample("fake-token", 200, NOW);
    expect(messages.length).toBeLessThanOrEqual(200);
    expect(stats.monthWindowsQueried).toBe(120);
    const report = diagnoseAddress(messages, "riley@example.test");
    expect(report.status).toBe("displayed");
    expect(report.outcomes.counted).toBeGreaterThanOrEqual(30);
  });

  it("honors a small ceiling and wrapper", async () => {
    const requests: URL[] = [];
    mockGmail(buildMailbox(), requests);
    const messages = await fetchHistoricalMessages("fake-token", 7, NOW);
    expect(messages.length).toBeLessThanOrEqual(7);
  });

  it("does not retry-loop forever on Gmail errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    await expect(fetchDiscoverySample("fake-token", 10, NOW)).rejects.toThrow();
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe("positive-control diagnostic", () => {
  const owner = "Owner <owner@example.test>";
  const out = (id: string, to: string, day = 1, extra: { name: string; value: string }[] = []) =>
    message(id, owner, to, `Mon, ${String(day).padStart(2, "0")} Jan 2024 10:00:00 +0000`, extra, true);
  const inc = (id: string, from: string, day = 2) =>
    message(id, from, owner, `Tue, ${String(day).padStart(2, "0")} Jan 2024 10:00:00 +0000`);

  /** 12 viable contacts; the last by address has the weakest evidence. */
  function crowd(): DiscoveryMessage[] {
    const messages: DiscoveryMessage[] = [];
    for (let i = 0; i < 12; i++) {
      const who = `p${String(i).padStart(2, "0")}@example.test`;
      const repeats = i === 11 ? 1 : 2;
      for (let r = 0; r < repeats; r++) {
        messages.push(out(`o${i}-${r}`, `P${i} <${who}>`, r + 1));
        messages.push(inc(`i${i}-${r}`, `P${i} <${who}>`, r + 10));
      }
    }
    return messages;
  }

  it("reports a displayed candidate with its rank among viable candidates", () => {
    const report = diagnoseAddress(crowd(), "P00@Example.test");
    expect(report).toMatchObject({ status: "displayed", rank: 1, viableCount: 12, displayLimit: 10 });
  });

  it("reports a viable candidate ranked below the display cutoff", () => {
    const report = diagnoseAddress(crowd(), "p11@example.test");
    expect(report).toMatchObject({ status: "viable-below-cutoff", rank: 12, viableCount: 12 });
    expect(analyzeDiscovery(crowd()).candidates.map((c) => c.address)).not.toContain("p11@example.test");
  });

  it("explains sampled-but-excluded addresses using the real filters", () => {
    const group = "Kim <kim@example.test>, Lee <lee@example.test>";
    const messages = [...crowd(), out("g", group), inc("lone", "Rae <rae@example.test>"), out("b", "Bo <bo@example.test>", 3, [{ name: "List-Id", value: "<x.example.test>" }])];
    expect(diagnoseAddress(messages, "kim@example.test")).toMatchObject({ status: "excluded", outcomes: { group: 1 } });
    expect(diagnoseAddress(messages, "rae@example.test")).toMatchObject({ status: "excluded", aggregateExclusion: "single-inbound" });
    expect(diagnoseAddress(messages, "bo@example.test")).toMatchObject({ status: "excluded", outcomes: { bulk: 1 } });
    expect(diagnoseAddress(messages, "owner@example.test")).toMatchObject({ status: "excluded", outcomes: { self: expect.any(Number) } });
    const draft = { ...out("d", "Dee <dee@example.test>"), labelIds: ["DRAFT"] };
    expect(diagnoseAddress([draft], "dee@example.test")).toMatchObject({ status: "excluded", outcomes: { draft: 1 } });
  });

  it("reports addresses absent from the sample as not sampled, not as nonexistent", () => {
    const report = diagnoseAddress(crowd(), "unknown@example.test");
    expect(report.status).toBe("not-sampled");
    expect(report.explanation).toMatch(/does not show/);
  });

  it("is inconclusive when evidence is ambiguous", () => {
    const broken = out("u", "Pat <pat@example.test>, not-an-address");
    expect(diagnoseAddress([broken], "pat@example.test").status).toBe("inconclusive");
    const bystander = inc("x", "Sam <sam@example.test>");
    bystander.payload!.headers!.find((h) => h.name === "To")!.value = "Pat <pat@example.test>";
    expect(diagnoseAddress([bystander], "pat@example.test").status).toBe("inconclusive");
  });

  it("never includes the probed address in the report", () => {
    const report = diagnoseAddress(crowd(), "p11@example.test");
    expect(JSON.stringify(report)).not.toContain("p11");
  });

  it("suppresses known owner aliases", () => {
    const messages = [out("a", "Old <old@example.test>")];
    expect(rankCandidates(messages)).toHaveLength(1);
    expect(analyzeDiscovery(messages, 10, { ownerAddresses: ["OLD@example.test"] }).candidates).toEqual([]);
  });
});

describe("bounded Gmail lookups", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes one list call and at most ten metadata fetches, and reads the owner profile", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.endsWith("/profile")) return new Response(JSON.stringify({ emailAddress: "Me@Example.test" }), { status: 200 });
      if (url.pathname.endsWith("/messages")) {
        return new Response(JSON.stringify({ messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` })), nextPageToken: "more" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "x", payload: { headers: [] } }), { status: 200 });
    }));
    expect(await fetchOwnerAddress("fake-token")).toBe("me@example.test");
    const { messages, truncated } = await fetchAddressLookup("fake-token", "zed@example.test");
    expect(messages).toHaveLength(10);
    expect(truncated).toBe(true);
    expect(urls.filter((u) => u.pathname.endsWith("/messages"))).toHaveLength(1);
    expect(urls.filter((u) => /\/messages\/[^/]+$/.test(u.pathname)).every((u) => !u.searchParams.get("fields")?.includes("body"))).toBe(true);
  });

  it("rejects malformed addresses before calling Gmail", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(fetchAddressLookup("fake-token", "a b@example.test) OR in:anywhere")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
