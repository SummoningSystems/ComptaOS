import {describe,it,expect} from "vitest";
import {resolveTool,switchToolScope} from "./toolCatalog";
describe("stable scoped tools",()=>{
 it("keeps IDs independent of translated labels",()=>{expect(resolveTool({view:"placeholder",scope:"root",toolId:"spreadsheets",label:"changed"})).toBe("spreadsheets");});
 it("opens the same compatible tool and preserves its period",()=>{const source={view:"placeholder" as const,scope:"alice",toolId:"spreadsheets" as const,period:"2026-09"};expect(switchToolScope(source,"bank",{id:"bank",name:"Bank",kind:"account"}).spec).toMatchObject({scope:"bank",toolId:"spreadsheets",period:"2026-09"});expect(source.scope).toBe("alice");});
 it("explains company-only fallback without rewriting the source",()=>{const next=switchToolScope({view:"placeholder",scope:"studio",toolId:"journal"},"alice",{id:"alice",kind:"person",name:"Alice"});expect(next.spec.toolId).toBe("overview");expect(next.notice).toBeTruthy();});
});
