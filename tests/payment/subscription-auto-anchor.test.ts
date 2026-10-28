import { describe, expect, it } from "vitest";
import { resolveSubscriptionAutoAnchorAfterPayment } from "../../payment/subscription-auto-anchor";

describe("resolveSubscriptionAutoAnchorAfterPayment", () => {
  const oldParent = "dedde1de-0137-4fb0-a219-2078a5a8a8e1";
  const newParent = "f7b7c791-5125-4d92-bcef-1530d1e75116";

  it("first payment becomes the anchor and is not a renewal", () => {
    expect(
      resolveSubscriptionAutoAnchorAfterPayment({
        existingAnchor: null,
        incomingOrderReference: newParent,
      }),
    ).toEqual({
      anchorOrderReference: newParent,
      isRenewal: false,
      isNewParentCheckout: false,
    });
  });

  it("WFPREG child keeps the existing anchor", () => {
    expect(
      resolveSubscriptionAutoAnchorAfterPayment({
        existingAnchor: oldParent,
        incomingOrderReference: `${oldParent}_WFPREG-498888-4`,
      }),
    ).toEqual({
      anchorOrderReference: oldParent,
      isRenewal: true,
      isNewParentCheckout: false,
    });
  });

  it("a new checkout parent replaces the old anchor", () => {
    expect(
      resolveSubscriptionAutoAnchorAfterPayment({
        existingAnchor: oldParent,
        incomingOrderReference: newParent,
      }),
    ).toEqual({
      anchorOrderReference: newParent,
      isRenewal: true,
      isNewParentCheckout: true,
    });
  });
});
