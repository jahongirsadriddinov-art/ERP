import { describe, it, expect } from "vitest";
import { guessGender } from "../components/UserAvatar";

describe("guessGender (memoji jinsga mos)", () => {
  it("familiya va ism bo'yicha", () => {
    expect(guessGender("Imom Sadulloev")).toBe("m");
    expect(guessGender("Jahongir")).toBe("m");
    expect(guessGender("Malika Karimova")).toBe("f");
    expect(guessGender("Dilnoza")).toBe("f");
    expect(guessGender("Gulnoraxon")).toBe("f");
    expect(guessGender("Hamza")).toBe("m");
    expect(guessGender("")).toBeNull();
  });
});
