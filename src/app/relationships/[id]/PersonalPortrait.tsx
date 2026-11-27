import type { PortraitGroup } from "@/lib/relationship-overview";
import { homeInteractionDate } from "@/lib/home-view";
import InterfaceIcon, { type InterfaceIconName } from "@/app/InterfaceIcon";

const groupIcons: Record<string, InterfaceIconName> = {
  "Interests & activities": "heart", "Family & life": "family", "Shared history": "history",
  "Looking ahead": "compass", "Work & projects": "work", "Earlier chapters": "history",
  "Places & plans": "pin", "Other things to remember": "chat",
};

/** Retain explicit wording, including changed/negative states. Never turn a
 * generic or old interest label into a present-tense claim. */
function PortraitItem({ item, chip }: { item: PortraitGroup["items"][number]; chip: boolean }) {
  const canUseLabel = chip && !/^(interest|hobby|activity|other|past|former)/i.test(item.label) &&
    item.label.length <= 32 && /^(enjoys|likes|loves|is interested in|has been learning)\b/i.test(item.value) &&
    !/\b(no longer|used to|stopped|formerly|not|never|doesn.t|can.t|but)\b/i.test(item.value);
  return (
    <li className={chip ? "min-w-0" : "min-w-0 text-sm leading-relaxed text-stone-800"}>
      <details>
        <summary title="Show saved wording and date"
          className={(canUseLabel ? "inline-flex rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 " : "block text-sm leading-relaxed text-stone-800 ") +
            "cursor-pointer list-none break-words hover:underline [&::-webkit-details-marker]:hidden"}>
          {canUseLabel ? item.label : item.value}
        </summary>
        <div className="mt-1.5 rounded-lg bg-white px-2.5 py-2 text-xs text-stone-600">
          {canUseLabel && <p className="text-sm text-stone-800">{item.value}</p>}
          <p>Recorded {homeInteractionDate(item.date)}</p>
        </div>
      </details>
    </li>
  );
}

export default function PersonalPortrait({ groups }: { groups: PortraitGroup[] }) {
  if (!groups.length) return <p className="text-sm text-stone-500">No personal context recorded yet.</p>;
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      {groups.map((group) => {
        const chip = group.label === "Interests & activities";
        return (
          <section key={group.label} className="rounded-xl bg-stone-100/80 px-4 py-3.5 sm:px-5 sm:py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <InterfaceIcon name={groupIcons[group.label] ?? "chat"} className="size-[18px] shrink-0 text-stone-500" />
              {group.label}
            </h3>
            <ul className={"mt-2.5 " + (chip ? "flex flex-wrap items-start gap-2" : "space-y-2")}>
              {group.items.slice(0, 3).map((item) => <PortraitItem key={item.id} item={item} chip={chip} />)}
            </ul>
            {group.items.length > 3 && (
              <details className="mt-2 text-xs text-stone-500">
                <summary className="cursor-pointer font-medium">More ({group.items.length - 3})</summary>
                <ul className="mt-2 space-y-2">{group.items.slice(3).map((item) => <PortraitItem key={item.id} item={item} chip={chip} />)}</ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
