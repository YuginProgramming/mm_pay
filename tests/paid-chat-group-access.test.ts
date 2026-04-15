/**
 * Доступ до платних Telegram-груп (MASTERS / Chat PRO) керується paid-chat janitor
 * (`runPaidChatJanitorSweepOnce` у `paid-chat-sweep.ts`), а не видаленням рядків у
 * `telegram_users`.
 *
 * Активна оплата MULTIMASKING у боті (`payment_hook`, `endAt` у майбутньому або null)
 * задається як `activeBotPayment`. Коли місячний доступ закінчився — у БД немає активного
 * рядка — `activeBotPayment` стає false — користувач **не повинен лишатися** в групах за
 * правилами нижче (фактичний kick через Bot API робить janitor, не цей unit-тест).
 */
import { describe, expect, it } from "vitest";
import type { KwigaAudienceRank } from "../telegram/profile/kwiga-user-rank";
import {
  shouldStayInCatPro,
  shouldStayInMasters,
} from "../telegram/paid-chat-janitor/paid-chat-sweep";

const RANKS: KwigaAudienceRank[] = [
  "no_kwiga_contact",
  "prospectives",
  "masters",
  "pro",
];

describe("paid-chat group access (MASTERS / Chat PRO)", () => {
  describe("when MULTIMASKING bot payment is NOT active (e.g. 30-day access ended)", () => {
    it("never keeps user in MASTERS or Chat PRO regardless of KWIGA rank", () => {
      for (const rank of RANKS) {
        expect(shouldStayInMasters(false, rank)).toBe(false);
        expect(shouldStayInCatPro(false, rank)).toBe(false);
      }
    });
  });

  describe("when MULTIMASKING bot payment IS active", () => {
    it("MASTERS: only masters or pro rank may stay", () => {
      expect(shouldStayInMasters(true, "masters")).toBe(true);
      expect(shouldStayInMasters(true, "pro")).toBe(true);
      expect(shouldStayInMasters(true, "prospectives")).toBe(false);
      expect(shouldStayInMasters(true, "no_kwiga_contact")).toBe(false);
    });

    it("Chat PRO: only pro rank may stay", () => {
      expect(shouldStayInCatPro(true, "pro")).toBe(true);
      expect(shouldStayInCatPro(true, "masters")).toBe(false);
      expect(shouldStayInCatPro(true, "prospectives")).toBe(false);
      expect(shouldStayInCatPro(true, "no_kwiga_contact")).toBe(false);
    });
  });
});
