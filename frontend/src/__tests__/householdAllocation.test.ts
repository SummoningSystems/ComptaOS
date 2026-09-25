import { describe,it,expect } from "vitest";
import { splitPercent } from "../components/Household/shared";
describe("allocation rounding",()=>{
  it("keeps the exact bank amount including a remainder cent",()=>{
    const result=splitPercent(-10001,[60,25,15]);
    expect(result).toEqual([-6001,-2500,-1500]);
    expect(result.reduce((a,b)=>a+b,0)).toBe(-10001);
  });
});
