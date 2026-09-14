import { describe, expect, it } from "vitest";
import {
  parentWayforpayOrderReference,
  wayforpayOrderReferenceLookupKeys,
} from "../../payment/wayforpay-order-reference";

describe("parentWayforpayOrderReference", () => {
  it("strips _WFPREG- suffix", () => {
    expect(
      parentWayforpayOrderReference(
        "724974d3-81ea-4e5e-b6ed-fae803189185_WFPREG-528105-1",
      ),
    ).toBe("724974d3-81ea-4e5e-b6ed-fae803189185");
  });

  it("leaves a parent UUID unchanged", () => {
    expect(parentWayforpayOrderReference("724974d3-81ea-4e5e-b6ed-fae803189185")).toBe(
      "724974d3-81ea-4e5e-b6ed-fae803189185",
    );
  });

  it("trims whitespace", () => {
    expect(
      parentWayforpayOrderReference("  abc_WFPREG-2.1  "),
    ).toBe("abc");
  });
});

describe("wayforpayOrderReferenceLookupKeys", () => {
  it("returns full then parent for WFPREG refs", () => {
    expect(
      wayforpayOrderReferenceLookupKeys("uuid-1_WFPREG-504454-2.1"),
    ).toEqual(["uuid-1_WFPREG-504454-2.1", "uuid-1"]);
  });

  it("returns a single key when there is no suffix", () => {
    expect(wayforpayOrderReferenceLookupKeys("uuid-1")).toEqual(["uuid-1"]);
  });
});
