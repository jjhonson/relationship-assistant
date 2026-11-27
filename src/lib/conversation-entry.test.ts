import { describe, expect, it } from "vitest";
import { conversationScope, findSavedPeople, personForPath } from "./conversation-entry";
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
  it("finds only saved names without implying AI search", () => {
    expect(findSavedPeople("taylor row",people)).toEqual([people[0]]);
    expect(findSavedPeople("Taylor",people)).toEqual([people[0],people[1]]);
    expect(findSavedPeople("",people)).toEqual([]);
  });
});
