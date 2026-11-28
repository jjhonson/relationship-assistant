import type { DurableRelationshipFact, RelationshipSource } from "./relationship-record";

export type LocationMeaning = "home" | "work" | "profile" | "unspecified";
type LocationFact = Pick<DurableRelationshipFact,"label"|"category"|"value">;
type DatedLocationFact = LocationFact & Pick<DurableRelationshipFact,"sourceIds"|"lastObservedAt">;
const home = new Set(["home","home city","home location","home area","residence","current residence","place of residence","residential location","where they live","lives in","current home city","current home"]);
const work = new Set(["work location","work city","workplace location","office location","office city","company location","company city","job location","job city","employment location","employer location","role location"]);
const profile = new Set(["profile location","linkedin location","profile city","linkedin city","profile region"]);
const unspecified = new Set(["city","location","current location","current city","based in","location (unspecified)","location (meaning unclear)"]);

/** Semantic location labels are independent of how recently they were observed.
 * An office location or profile region is not evidence of where someone lives. */
export function explicitLocationMeaning(fact:LocationFact):LocationMeaning | null {
  const label=fact.label.trim().toLowerCase().replace(/\s+/g," ");
  if(fact.category==="Location"&&home.has(label))return "home";
  if((fact.category==="Location"||fact.category==="Work")&&work.has(label))return "work";
  if(fact.category==="Location"&&profile.has(label))return "profile";
  if(fact.category==="Location"&&unspecified.has(label))return "unspecified";
  return null;
}

/** Earlier conversation extraction explicitly defined the canonical City
 * label as current home city/area. Retain that legacy contract only for an
 * attributed conversation observation, not ordinary notes/photos/metadata.
 * A generic "Location" has never established a specific meaning. */
export function locationMeaning(fact:DatedLocationFact,sources:ReadonlyMap<string,RelationshipSource>):LocationMeaning|null {
  const meaning=explicitLocationMeaning(fact);
  if(meaning!=="unspecified")return meaning;
  const label=fact.label.trim().toLowerCase();
  if(label==="city"){
    const observations=fact.sourceIds.map(id=>sources.get(id)).filter(source=>source?.observedAt===fact.lastObservedAt);
    if(observations.length&&observations.every(source=>source?.source==="transcript"||source?.id.startsWith("pasted:")))return "home";
  }
  return "unspecified";
}

export function locationDisplayLabel(meaning:LocationMeaning):string {
  return {home:"Home location",work:"Work location",profile:"Profile location",unspecified:"Location (meaning unclear)"}[meaning];
}
