import { describe, expect, it } from "vitest";
import {
  compareKwigaRanks,
  mergeMonotonicKwigaSnapshot,
} from "../../telegram/profile/kwiga-user-rank";

describe("mergeMonotonicKwigaSnapshot (TZ/rank-info.txt)", () => {
  it("first write: no stored → candidate", () => {
    const r = mergeMonotonicKwigaSnapshot({
      storedRank: null,
      storedCount: null,
      candidateRank: "prospectives",
      candidateCount: 0,
    });
    expect(r).toEqual({ rank: "prospectives", accessRowCount: 0 });
  });

  it("upgrade: stored masters → candidate pro", () => {
    const r = mergeMonotonicKwigaSnapshot({
      storedRank: "masters",
      storedCount: 2,
      candidateRank: "pro",
      candidateCount: 5,
    });
    expect(r).toEqual({ rank: "pro", accessRowCount: 5 });
  });

  it("no downgrade: stored pro → candidate prospectives (fewer rows in sync)", () => {
    const r = mergeMonotonicKwigaSnapshot({
      storedRank: "pro",
      storedCount: 5,
      candidateRank: "prospectives",
      candidateCount: 0,
    });
    expect(r).toEqual({ rank: "pro", accessRowCount: 5 });
  });

  it("same tier: keep stored count when both masters", () => {
    const r = mergeMonotonicKwigaSnapshot({
      storedRank: "masters",
      storedCount: 3,
      candidateRank: "masters",
      candidateCount: 2,
    });
    expect(r).toEqual({ rank: "masters", accessRowCount: 3 });
  });
});

describe("compareKwigaRanks", () => {
  it("pro > masters", () => {
    expect(compareKwigaRanks("pro", "masters")).toBeGreaterThan(0);
  });
  it("no_kwiga < prospectives", () => {
    expect(compareKwigaRanks("no_kwiga_contact", "prospectives")).toBeLessThan(0);
  });
});
