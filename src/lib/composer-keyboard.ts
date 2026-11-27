/** Enter submits; Shift+Enter inserts a line break. Ignore IME composition
 * and do not submit while a request/import is pending. */
export function shouldSubmitComposerKey(event:{key:string;shiftKey:boolean;isComposing:boolean;keyCode:number}):boolean {
  return event.key==="Enter"&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229;
}
