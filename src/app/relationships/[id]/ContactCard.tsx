import type { ContactField, ContactObservation, ContactValue } from "@/lib/relationship-overview";
import { homeInteractionDate } from "@/lib/home-view";

function sourceType(source: ContactObservation) {
  return { gmail: "Email metadata", transcript: "Conversation", manual: "Saved context", capture: "Saved note or photo" }[source.source];
}

function ValueEvidence({ value, primary }: { value: ContactValue; primary: boolean }) {
  const observed = value.observations.filter((source) => source.attribution === "value");
  const earlier = value.observations.filter((source) => source.attribution === "earlier-context");
  return (
    <li className="space-y-2 border-t border-stone-200 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <p className="break-words text-sm font-medium text-stone-900">{value.value}</p>
      <p className="text-xs text-stone-600">
        {primary ? "Most recently recorded" : "Also recorded"} · {homeInteractionDate(value.observedAt)}
        {value.confirmed ? " · Identity confirmed" : ""}
      </p>
      <ul className="space-y-1.5 text-xs text-stone-600">
        {observed.map((source) => (
          <li key={source.id} className="border-l-2 border-stone-200 pl-2">
            <span className="font-medium">{sourceType(source)} · {homeInteractionDate(source.observedAt)}</span>
            <span className="block">{source.label}</span>
          </li>
        ))}
      </ul>
      {earlier.length > 0 && (
        <details className="text-xs text-stone-500">
          <summary className="cursor-pointer">Earlier linked context ({earlier.length})</summary>
          <p className="mt-1">These sources may describe an earlier version of the fact, not this exact value.</p>
          <ul className="mt-2 space-y-1.5">
            {earlier.map((source) => <li key={source.id}>{sourceType(source)} · {homeInteractionDate(source.observedAt)} · {source.label}</li>)}
          </ul>
        </details>
      )}
    </li>
  );
}

function ContactSlot({ field }: { field: ContactField }) {
  const { primary, values } = field;
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-stone-500">{field.label}</dt>
      <dd className="mt-1 min-w-0">
        {primary ? (
          <p className="break-words text-sm font-medium leading-relaxed text-stone-900">
            {field.label === "LinkedIn" ? <a href={primary.value} target="_blank" rel="noreferrer"
              className="underline decoration-stone-300 underline-offset-4 hover:decoration-stone-800">{primary.value}</a> : primary.value}
          </p>
        ) : <p className="text-sm text-stone-400">{values.length ? "Multiple recorded values" : "Not recorded"}</p>}
        {values.length > 0 && (
          <details className="mt-1.5 text-xs text-stone-500">
            <summary className="cursor-pointer font-medium underline-offset-4 hover:text-stone-800 hover:underline">
              {values.length > 1 ? values.length + " recorded values · Sources" : "Sources"}
            </summary>
            <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
              {!primary && <p className="mb-3 text-xs text-stone-600">More than one value was recorded on the latest date. No single value is selected.</p>}
              {values.length > 1 && primary && <p className="mb-3 text-xs text-stone-600">The latest recorded value is shown above. Earlier values may still be valid.</p>}
              <ul>
                {values.map((value) => <ValueEvidence key={value.value} value={value} primary={primary?.value === value.value} />)}
              </ul>
            </div>
          </details>
        )}
      </dd>
    </div>
  );
}

export default function ContactCard({ fields }: { fields: ContactField[] }) {
  return (
    <dl aria-label="Contact information" className="mt-5 grid items-start gap-x-8 gap-y-5 border-t border-stone-100 pt-5 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => <ContactSlot key={field.label} field={field} />)}
    </dl>
  );
}
