import { describe, expect, it } from "vitest";
import { conversationScope, filterDirectoryPeople, personForPath } from "./conversation-entry";
const people = [{id:"a",label:"Rowan Taylor"},{id:"b",label:"Avery Taylor"},{id:"c",label:"Casey Park"}];
describe("persistent conversation context", () => {
  it("follows the active person when no unsaved draft exists", () => {
    expect(conversationScope("/relationships/a",people,null)).toBe("a");
    expect(conversationScope("/relationships/b",people,null)).toBe("b");
    expect(conversationScope("/",people,null)).toBeUndefined();
    expect(personForPath("/relationships",people)).toBeUndefined();
  });
  it("preserves a draft's original scope on navigation including general drafts", () => {
    expect(conversationScope("/relationships/b",people,{relationshipId:"a"})).toBe("a");
    expect(conversationScope("/",people,{relationshipId:"a"})).toBe("a");
    expect(conversationScope("/relationships/b",people,{relationshipId:null})).toBeUndefined();
  });
  it("lists every saved person alphabetically by display name and filters by typed name", () => {
    expect(filterDirectoryPeople("",people)).toEqual([people[1],people[2],people[0]]);
    expect(filterDirectoryPeople("  ",people)).toEqual([people[1],people[2],people[0]]);
    expect(filterDirectoryPeople("taylor row",people)).toEqual([people[0]]);
    expect(filterDirectoryPeople("Taylor",people)).toEqual([people[1],people[0]]);
    expect(filterDirectoryPeople("missing",people)).toEqual([]);
    expect(people.map((p) => p.id)).toEqual(["a","b","c"]);
  });
  it("keeps duplicate display names distinct, with their original row details", () => {
    const rows = [{id:"z",label:"Alex Smith",detail:"One"},{id:"a",label:"Alex Smith",detail:"Two"}];
    expect(filterDirectoryPeople("alex",rows)).toEqual([rows[1],rows[0]]);
  });
});
