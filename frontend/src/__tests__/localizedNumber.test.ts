import { describe, expect, it } from "vitest";
import { clampNumber, parseLocalizedNumber } from "../utils/localizedNumber";
import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { LocalizedNumberInput } from "../components/Common/LocalizedNumberInput";

describe("localizedNumber", () => {
  it("accepte la virgule et le point décimal", () => {
    expect(parseLocalizedNumber("12,50")).toBe(12.5);
    expect(parseLocalizedNumber("12.50")).toBe(12.5);
    expect(parseLocalizedNumber(" 1 234,56 ")).toBe(1234.56);
  });
  it("conserve les valeurs négatives et refuse les saisies incomplètes", () => {
    expect(parseLocalizedNumber("-15.8")).toBe(-15.8);
    expect(parseLocalizedNumber(".")).toBeUndefined();
    expect(parseLocalizedNumber("")).toBeUndefined();
  });
  it("applique les bornes à la validation", () => {
    expect(clampNumber(-2, 0)).toBe(0);
    expect(clampNumber(120, 0, 100)).toBe(100);
  });
  it("ne remplace pas une saisie décimale intermédiaire par zéro", () => {
    const values: number[] = [];
    const { getByRole } = render(createElement(LocalizedNumberInput, { value: 12, onValueChange: (value) => values.push(value) }));
    const field = getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(field); fireEvent.change(field, { target: { value: "12." } });
    expect(field.value).toBe("12."); expect(values).toEqual([]);
    fireEvent.change(field, { target: { value: "12.50" } }); fireEvent.blur(field);
    expect(values).toEqual([12.5]);
  });
});
