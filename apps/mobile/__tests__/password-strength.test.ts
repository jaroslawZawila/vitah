import { passwordStrength } from "../lib/password-strength";

describe("passwordStrength", () => {
  it("is empty for an empty password", () => {
    expect(passwordStrength("")).toBeNull();
  });

  it.each([
    ["abc", 0, "weak"],
    ["abcdefghijk", 1, "weak"],
    ["Abcdefghijk", 2, "fair"],
    ["CasaNordica26", 3, "good"], // the design's example: "Seguridad alta"
    ["CasaNordica26!", 4, "strong"],
  ])("%s → %i bars, %s", (password, bars, label) => {
    expect(passwordStrength(password)).toEqual({ bars, label });
  });
});
