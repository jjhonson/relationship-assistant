# Personal alpha: From memory to meaningful connection

> Status: planned and under active development (November 2026). This is a personal-use milestone, not the commercially viable V1. See [tracking issue #52](https://github.com/jjhonson/relationship-assistant/issues/52).

## What problem are we solving?

Interesting things happen in our lives, and we know people who might appreciate them, benefit from them, or share the interest. But the connections between those moments and those people often get lost in the work of remembering, preparing, following up, and keeping track.

Relationship Assistant aims to reduce that work without taking the human part out of the relationship. It should suggest **relevant subjects, ideas, shared context, or contributions** for a one-to-one connection. It should not tell people to contact someone merely to satisfy a cadence, and it is not trying to become a sales CRM.

## The experience we want

1. **Remember:** A quick text or selected photo creates or enriches a person and dated memories. Missing facts stay missing; ambiguous names require care.
2. **Notice:** From a person or a meaningful personal moment, find a small number of credible reasons to connect, based on actual evidence. 'Nothing worth suggesting right now' is a valid result.
3. **Connect:** Help prepare a specific one-to-one interaction. The person remains in control of what to say, how to say it, and whether to send.
4. **Learn:** Record what really happened, from a new message, conversation or deliberately captured note. Distinguish planned, sent, scheduled, and occurred.
5. **Improve:** The accumulated record makes future interactions more natural, not just more frequent.

## What's working already

- Intentional one-box text capture with cautious creation/update of provisional people.
- Intentional photo capture with extracted text and visual observations kept separate from user input; the original image is not retained.
- Cumulative, source-aware relationship records, explicit identity ambiguity resolution, and limited correction.
- Explicit connected-person links and potential household context shared across profiles with clear attribution and no fabricated interaction.
- Fictional automated tests and an existing local-development app. The older home dashboard is still sample data.

These features are not a deployed, hosted product. The current relationship store is a private local JSON file in the development environment, which **is not yet suitable as a durable personal system of record**.

## Workstreams toward an experienceable product

| Workstream | Tracked work | Target outcome |
| --- | --- | --- |
| Person-first connection | [#53](https://github.com/jjhonson/relationship-assistant/issues/53), with lessons from draft PR #42 | Open a person and identify a specific, evidenced subject or useful gesture, or no action |
| Durable memory | [#54](https://github.com/jjhonson/relationship-assistant/issues/54) | Survive environment loss and schema upgrades with tested backup and recovery |
| Moment-first matching | Follow-up under [#52](https://github.com/jjhonson/relationship-assistant/issues/52) | Save a meaningful experience and discover relevant people without inventing a match |
| Follow-through and learning | Follow-up under [#52](https://github.com/jjhonson/relationship-assistant/issues/52); memory corrections [#43](https://github.com/jjhonson/relationship-assistant/issues/43) | Preserve what was actually done and learned; do not confuse copied drafts with sent messages |
| Project quality | [#55](https://github.com/jjhonson/relationship-assistant/issues/55) | An approachable public project with honest status, CI and navigable decisions |

## Personal-alpha acceptance test

Using a small curated set of real relationships, we should be able to open a person, get a credible suggestion sourced to actual history or a meaningful moment, decide to act (or not), and then record the result. At least one person-first and one moment-first experience should be live rather than scripted. We will judge success by whether the product enables a valuable human connection that might otherwise have been missed, not by the number of recommendations or messages.

Before the private pilot expands beyond a few records, relationship memory must live outside the disposable Codespace environment, with a documented migration, independent backup, and verified restore.

## Non-goals for the alpha

- Autonomous or bulk outbound messaging; sales pipeline follow-up; contact-frequency quotas.
- Full passive ingestion of email, social platforms or browsing history, or permission scopes beyond what the user separately authorizes.
- Polished visual design, subscriptions, commercial onboarding, multi-tenant account management, or a generalized social graph.
- Publishing private people, correspondence, original cards, raw transcripts, private test data or API keys as development artifacts.

## How this repository documents progress

Product issues identify outcomes and tradeoffs. Small PRs carry code, tests, and decisions. Public examples use synthetic people and content. The contribution graph is a byproduct of doing real work, not a metric to optimize through filler commits.
