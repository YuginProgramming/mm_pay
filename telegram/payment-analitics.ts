// telegram/payment-analitics.ts
// Run: npx ts-node telegram/payment-analitics.ts
// Same order rules as payment-check.ts; prints counts only.
import "dotenv/config";
import { Contact } from "../database/Contact";
import { sequelize } from "../database/db";

function countPaid(contacts: Contact[]): number {
  return contacts.filter((contact) =>
    (contact.orders ?? []).some((order) => order.paid_status === "paid"),
  ).length;
}

function countNotPaid(contacts: Contact[]): number {
  return contacts.filter((contact) =>
    (contact.orders ?? []).some((order) => order.paid_status === "not_paid"),
  ).length;
}

export async function logPaymentAnalytics(): Promise<void> {
  await sequelize.authenticate();
  const contacts = await Contact.findAll();
  const paid = countPaid(contacts);
  const notPaid = countNotPaid(contacts);
  console.log(`Paid (paid_status = "paid"): ${paid}`);
  console.log(`Not paid (paid_status = "not_paid"): ${notPaid}`);
}

async function main(): Promise<void> {
  try {
    await logPaymentAnalytics();
  } catch (e) {
    console.error("Payment analytics failed:", e);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

void main();
