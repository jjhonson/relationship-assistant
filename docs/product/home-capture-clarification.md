# Home capture: progressively clarify, don't ask users to approve their own notes

**Product owner feedback, Nov 25, 2026.** The current grayscale Home is accepted as a useful baseline, but the composer should feel like an established conversational interface: wider, uncluttered, minimal explanatory copy. The preview/approval step is a development diagnostic, **not** a permanent interaction requirement.

## Desired default interaction

1. The user writes, dictates into the native text box, pastes text, or attaches a supported file and deliberately presses **Save** (or the final equivalent). No background recording or passive ingestion.
2. The assistant interprets and routes it without asking the user to endorse its paraphrase when it can do so safely. Normal user-authored memories should be stored with clear attribution and the user's intended meaning.
3. **Ask only a concrete question that blocks trustworthy storage**, for example “Was this your own note or a pasted message?”, “Which Judy did you mean?”, or “When was that conversation?” Preserve the draft while asking.
4. The user can inspect and correct what was remembered after saving, via the appropriate person/capture/moment record. Corrections retain source provenance and the history of prior interpretations.
5. A failure or uncertain save response retains the user's input. Never silently retry a possibly committed write, create a duplicate, or claim that nothing was saved when the server response is indeterminate.

## Retention and identity boundaries

- **User-authored recollection:** can be saved as the user's original note, with sourced facts extracted for a matched person. No compulsory approval of the extracted summary.
- **Pasted third-party conversation, email, or transcript:** use the existing extract-only pathway; do not save the raw pasted content under the guise of the user's own note. If unclear, clarify the material's authorship rather than taking a risky guess.
- **Moment or personal thought:** private by default. Don't match to another person, send advice, or offer outreach simply because it was saved.
- **Person resolution:** match a unique existing relationship when supported. If multiple people match, ask which person. Never silently merge identities or invent a relationship record.
- **Date resolution:** the interaction date is distinct from the capture/saved date. Resolve explicit relative dates like “yesterday” against the user's local time zone at submission, not the UTC server date. If the date cannot be determined, keep it unknown or ask once; don't assign the capture date as a fabricated interaction date.
- **Privacy:** retain source markers and clear which details are inferred vs user-supplied, but present those details on demand rather than under every card.

## Captured acceptance example: Fictional Judy

The fictional input “I spoke with Fictional Judy Test yesterday. She's thinking about running her first 5K in December, but she hasn't registered yet. She's having trouble finding time to train and seems a little uncertain about whether she can finish” was saved in the real Supabase dev data. Two source-backed facts were successfully extracted and attached to Judy. **However `lastInteractionAt` remained null**, even though “yesterday” provided a usable relative day. The source's observed date was the server/UTC capture day. Future direct-save work must capture the conversation's local-date semantics separately and prove the correct day.

Desired test: submitted on **Nov 25, 2026 America/Denver**, “yesterday” means **Nov 24, 2026**. Persist `lastInteractionAt` as Nov 24, not Nov 25 (submit day) or Nov 26 (UTC rollover), while retaining the source's real ingestion timestamp. Don't mark the planned December race completed or assign a signup date; “hasn't registered” is reported, not verified as current after the conversation.

## Alpha staging

**Current draft PR #75:** keep the explicit Review → Confirm and save step until we have tests for authorship/provenance routing, identity, relative dates, no-mutation preview, and duplicate-safe persistence. Simplify copy and widen the composer now without quietly changing its retention contract.

**Next implementation:** a true one-submit, ask-only-if-needed save flow. It must pass positive and negative fixtures for authored notes vs pasted dialogue, clear/ambiguous identities, local-date conversion, duplicate request handling, private moments, model failures, and safe post-save correction. No new mandatory multi-field form, contact quotas, or periodic checking of another person's goals.

**Before real-person data:** independent encrypted backup restore to a separate database and appropriate application authorization are still prerequisites.
