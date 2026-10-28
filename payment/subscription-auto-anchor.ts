import { parentWayforpayOrderReference } from "./wayforpay-order-reference";

export type SubscriptionAutoAnchorResolution = {
  anchorOrderReference: string;
  isRenewal: boolean;
  isNewParentCheckout: boolean;
};

/**
 * One live WayForPay regular per user: a new checkout parent becomes the new anchor.
 * WFPREG children of the current anchor stay on that anchor.
 */
export function resolveSubscriptionAutoAnchorAfterPayment(args: {
  existingAnchor: string | null | undefined;
  incomingOrderReference: string;
}): SubscriptionAutoAnchorResolution {
  const incomingRaw = args.incomingOrderReference.trim();
  const incomingParent = parentWayforpayOrderReference(incomingRaw);
  const existingParent = parentWayforpayOrderReference(args.existingAnchor ?? "");

  if (!existingParent) {
    return {
      anchorOrderReference: incomingParent,
      isRenewal: false,
      isNewParentCheckout: false,
    };
  }

  if (incomingParent === existingParent) {
    return {
      anchorOrderReference: existingParent,
      isRenewal: incomingRaw !== existingParent,
      isNewParentCheckout: false,
    };
  }

  return {
    anchorOrderReference: incomingParent,
    isRenewal: true,
    isNewParentCheckout: true,
  };
}
