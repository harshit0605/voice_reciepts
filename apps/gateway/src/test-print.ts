// Prints a sample receipt with the gateway's printer settings, to check a newly connected printer:
// paper width, Hindi text, the cut. Run from apps/gateway:
//
//   tsx --env-file=../../.env src/test-print.ts
import { demoState, execute, type Invoice } from "@counterwell/core";
import { printerConnection, printInvoice } from "./printer";

const connection = printerConnection();
if (!connection) {
  console.error(
    "No printer is configured (PRINTER_NAME, PRINTER_RAW or PRINTER_HOST).",
  );
  process.exit(1);
}
const state = demoState();
state.settings.name = "Counterwell test print";
const actor = {
  id: "demo-owner",
  businessId: state.businessId,
  role: "owner" as const,
  canCollect: true,
  offlineAuthorized: true,
};
const invoice = execute(
  state,
  {
    id: "test-print",
    occurredAt: new Date().toISOString(),
    operation: {
      type: "offline.checkout",
      orderId: "test-print",
      deviceId: "demo-device",
      sequence: 1,
      dispenserId: actor.id,
      counterId: "counter-1",
      lines: [
        {
          batchId: "dolo-b1",
          quantity: "1",
          unit: "tablet",
          confirmed: true,
          pricePaise: 280,
          taxBps: 1200,
        },
      ],
      cashPaise: 280,
    },
  },
  actor,
).result as Invoice & { paid?: string };
invoice.paid = "Paid ₹2.80 by cash · नकद भुगतान";
await printInvoice(invoice);
console.log(
  `Test receipt sent to ${connection.kind === "windows" ? connection.name : connection.address} on ${process.env.PRINTER_WIDTH_MM ?? 80} mm paper.`,
);
