import type { ContactField, ContactObservation, ContactValue } from "@/lib/relationship-overview";
import { homeInteractionDate } from "@/lib/home-view";
import InterfaceIcon, { type InterfaceIconName } from "@/app/InterfaceIcon";

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

const fieldIcons: Record<ContactField["label"], InterfaceIconName> = {
  Company: "work", Title: "work", Location: "pin", Email: "mail", Phone: "phone", LinkedIn: "link", Birthday: "cake",
};

function ContactSlot({ field }: { field: ContactField }) {
  const { primary, values } = field;
  const multiple = values.length > 1;
  const conflict = !primary && multiple;
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
        <InterfaceIcon name={fieldIcons[field.label]} className="size-3.5" />{field.label}
      </dt>
      <dd className="mt-1 min-w-0">
        {values.length ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded text-sm font-medium leading-relaxed text-stone-900 outline-offset-4 hover:underline focus-visible:outline-2 [&::-webkit-details-marker]:hidden"
              title={conflict ? "Multiple values on the latest date" : multiple ? values.length + " recorded values" : "View supporting evidence"}>
              <span className="min-w-0 break-words">{primary?.value ?? "Multiple values"}</span>
              {multiple && <span className={"mt-0.5 flex shrink-0 items-center gap-0.5 " + (conflict ? "text-amber-700" : "text-stone-500")}>
                <InterfaceIcon name={conflict ? "alert" : "layers"} className="size-3.5" />
                <span className="sr-only">{conflict ? "Unresolved alternatives" : values.length + " recorded values"}</span>
              </span>}
              <span className="sr-only">; show {field.label.toLowerCase()} evidence</span>
            </summary>
            <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
              {conflict && <p className="mb-3 text-xs text-stone-600">More than one value was recorded on the latest date. No single value is selected.</p>}
              {multiple && primary && <p className="mb-3 text-xs text-stone-600">Latest recorded value shown. Earlier values may still be valid.</p>}
              <ul>{values.map((value) => <ValueEvidence key={value.value} value={value} primary={primary?.value === value.value} />)}</ul>
              {field.label === "LinkedIn" && primary && <a href={primary.value} target="_blank" rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">Open profile <InterfaceIcon name="arrow" className="size-3" /></a>}
            </div>
          </details>
        ) : <p className="text-sm text-stone-400">Not recorded</p>}
      </dd>
    </div>
  );
}

export default function ContactCard({ fields }: { fields: ContactField[] }) {
  return (
    <dl aria-label="Contact information" className="mt-5 grid items-start gap-x-7 gap-y-4 border-t border-stone-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => <ContactSlot key={field.label} field={field} />)}
    </dl>
  );
}
