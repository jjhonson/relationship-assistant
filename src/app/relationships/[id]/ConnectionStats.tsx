import type { RelationshipConnectionStats } from "@/lib/relationship-connection-stats";
import type { ContactCadence } from "@/lib/relationship-cadence";
import { contactCadenceOptions } from "@/lib/relationship-cadence";
import { updateContactCadence } from "../cadence-actions";

export default function ConnectionStats({ stats, lastContact, cadence, relationshipId, cadenceDays }: {
  stats: RelationshipConnectionStats;
  lastContact: { date: string; elapsed: string };
  cadence: ContactCadence | null;
  relationshipId: string;
  cadenceDays?: number;
}) {
  const max = Math.max(1, ...stats.months.map((month) => month.count));
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-stone-500">{stats.group}</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-stone-500">Last recorded contact</dt>
          <dd className="mt-1 text-lg font-semibold tracking-tight text-stone-900">{lastContact.elapsed || lastContact.date}</dd>
          {lastContact.elapsed && <p className="text-xs text-stone-500">{lastContact.date}</p>}
        </div>
        <div>
          <dt className="text-xs text-stone-500">Contact days · 12 months</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-stone-900">{stats.recordedDays}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-stone-500">{cadence?.userSelected ? "Your cadence" : "Suggested cadence"}</dt>
          <dd className="mt-1">
            <details>
              <summary className="cursor-pointer list-none text-sm font-semibold text-stone-900 hover:underline [&::-webkit-details-marker]:hidden">
                {cadence?.label ?? "Still learning"} <span className="text-xs font-normal text-stone-500" aria-hidden="true">⌄</span>
                <span className="sr-only">, adjust cadence</span>
              </summary>
              {cadence && <p className="mt-2 text-xs text-stone-600">{cadence.basis}. A guide, not a quota.</p>}
              <form action={updateContactCadence.bind(null, relationshipId)} className="mt-2 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="contact-cadence">Contact cadence</label>
                <select id="contact-cadence" name="contactCadence" defaultValue={cadenceDays === undefined ? "suggested" : String(cadenceDays)}
                  className="max-w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-xs">
                  <option value="suggested">Use suggested cadence</option>
                  {contactCadenceOptions.map((item) => <option key={item.days} value={item.days}>{item.label}</option>)}
                </select>
                <button type="submit" className="rounded-md bg-stone-900 px-3 py-1.5 text-xs text-white">Save</button>
              </form>
            </details>
          </dd>
        </div>
      </dl>
      <div className="mt-5" role="img" aria-label={"Distinct recorded contact days by month. " + stats.months.map((month) => month.month + ": " + month.count).join("; ")}>
        <div className="grid grid-cols-12 gap-1.5 sm:gap-2">
          {stats.months.map((month, i) => (
            <div key={month.month} className="min-w-0">
              <div className="flex h-14 items-end border-b border-stone-200">
                <div title={month.month + " · " + month.count + " recorded contact days"}
                  className={"w-full rounded-t-sm " + (month.count ? "bg-stone-500" : "bg-stone-100")}
                  style={{height: month.count ? (month.count / max * 100) + "%" : "2px"}} />
              </div>
              <p className="mt-1 text-center text-[10px] text-stone-500">{i % 3 === 0 || i === 11 ? month.label : " "}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-xs text-stone-500">Recorded contact days, not total activity.</p>
    </div>
  );
}
