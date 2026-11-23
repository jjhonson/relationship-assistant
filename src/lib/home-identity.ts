/** A cautious local hint; no relationship is created or automatically linked. */
export type HomePersonChoice = { id: string; label: string };

export function suggestHomePerson(text: string, people: HomePersonChoice[]) {
  const excerpt = text.slice(0, 1000);
  const names = people.filter((person) => person.id && person.label.trim());
  const escape = (value: string) => value.replace(/[.*+?^()|[\]\\$]/g, "\\$&");

  // Prefer full saved labels. A mention of two people is ambiguous.
  const exact = names.filter((person) =>
    new RegExp("(^|[^A-Za-z])" + escape(person.label.trim()) + "($|[^A-Za-z])", "im").test(excerpt));
  if (exact.length === 1) return { id: exact[0].id, ambiguous: false };
  if (exact.length > 1) return { id: null, ambiguous: true };

  // A first name only counts after an explicit cue or as a speaker,
  // and only when associated with exactly one saved person.
  const contextual = names.filter((person) => {
    const first = person.label.trim().split(/\s+/)[0];
    if (first.length < 2) return false;
    const cue = new RegExp(
      "(?:\\b(?:with|met|saw|about|called|spoke to|talked to)\\s+" + escape(first) + "\\b)|" +
      "(?:^\\s*" + escape(first) + "\\s*:)",
      "im",
    );
    return cue.test(excerpt);
  });
  return contextual.length === 1
    ? { id: contextual[0].id, ambiguous: false }
    : { id: null, ambiguous: contextual.length > 1 };
}
