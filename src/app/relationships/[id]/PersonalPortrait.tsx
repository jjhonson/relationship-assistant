import type { PortraitGroup } from "@/lib/relationship-overview";
import { homeInteractionDate } from "@/lib/home-view";

export default function PersonalPortrait({ groups }: { groups: PortraitGroup[] }) {
  return (
    <section aria-labelledby="portrait-heading" className="space-y-4">
      <h2 id="portrait-heading" className="text-lg font-semibold tracking-tight text-stone-900">About them</h2>
      {groups.length ? (
        <div className="grid items-start gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.label} className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-stone-900">{group.label}</h3>
              <ul className="mt-3 space-y-3">
                {group.items.slice(0, 3).map((item) => (
                  <li key={item.id} className="text-sm leading-relaxed text-stone-800">
                    <span className="font-medium text-stone-900">{item.label}</span>
                    <span className="mt-0.5 block">{item.value}</span>
                    <span className="mt-0.5 block text-xs text-stone-500">Recorded {homeInteractionDate(item.date)}</span>
                  </li>
                ))}
              </ul>
              {group.items.length > 3 && (
                <details className="mt-3 border-t border-stone-100 pt-3 text-sm text-stone-600">
                  <summary className="cursor-pointer text-xs font-medium">More ({group.items.length - 3})</summary>
                  <ul className="mt-2 space-y-3">
                    {group.items.slice(3).map((item) => <li key={item.id}>
                      <p className="font-medium text-stone-900">{item.label}</p>
                      <p>{item.value}</p>
                      <p className="text-xs text-stone-500">Recorded {homeInteractionDate(item.date)}</p>
                    </li>)}
                  </ul>
                </details>
              )}
            </section>
          ))}
        </div>
      ) : <p className="text-sm text-stone-500">As you remember more about this person, useful context will appear here.</p>}
      {groups.length > 0 && <p className="text-xs text-stone-500">Based on saved context. Earlier observations may not reflect today.</p>}
    </section>
  );
}
