import type { Command } from "./contracts";
import type { Invoice, Order, OrderLine, State } from "./types";
/**
 * Identity of one basket's payment attempt, saved in the sale draft before
 * anything is sent. Retries, restarts and payment-method changes reuse it, so
 * one basket cannot become two orders or two invoices.
 */
export type CheckoutAttempt = {
  orderId: string;
  /** Command for a local cash sale; its invoice ID is `${cashCommandId}:invoice`. */
  cashCommandId: string;
  /** Set once the order has been sent to the server. From then on the basket is billed only through that order, never as a new local cash sale. */
  online: boolean;
};
export type CheckoutRecovery =
  | { kind: "none" }
  | { kind: "billed"; invoice: Invoice }
  | { kind: "saved_locally" }
  | { kind: "elsewhere" }
  | { kind: "uncertain" }
  | { kind: "held"; order: Order }
  | { kind: "unsent" };
export function commandOrderId(command: Command): string | undefined {
  const op = command.operation;
  if ("orderId" in op && typeof op.orderId === "string") return op.orderId;
  if (op.type === "approval.request" && typeof op.payload.orderId === "string")
    return op.payload.orderId;
  return undefined;
}
/**
 * Decide what already happened to a draft's payment attempt from recorded
 * state alone, so recovery never depends on staff remembering to check Orders.
 */
export function recoverCheckout(
  attempt: CheckoutAttempt | undefined,
  state: State,
  actorId: string,
  queuedCommandIds: readonly string[],
  uncertain: Command | null | undefined,
): CheckoutRecovery {
  if (!attempt) return { kind: "none" };
  const invoice =
    state.invoices[`${attempt.cashCommandId}:invoice`] ??
    Object.values(state.invoices).find((i) => i.orderId === attempt.orderId);
  if (invoice) return { kind: "billed", invoice };
  if (queuedCommandIds.includes(attempt.cashCommandId))
    return { kind: "saved_locally" };
  if (uncertain && commandOrderId(uncertain) === attempt.orderId)
    return { kind: "uncertain" };
  const order = state.orders[attempt.orderId];
  if (!order) return { kind: "unsent" };
  return order.status === "held" && order.collectorId === actorId
    ? { kind: "held", order }
    : { kind: "elsewhere" };
}
/** A basket that has reached the server is only ever billed through its order. */
export function billsLocally(
  method: string,
  attempt: CheckoutAttempt | undefined,
  existingOrderId?: string,
) {
  return method === "cash" && !existingOrderId && !attempt?.online;
}
const stable = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
/** Re-saving an unchanged order would bump its version and void approvals tied to it. */
export function orderMatches(
  order: Order,
  content: {
    lines: OrderLine[];
    customerId?: string;
    prescription?: Order["prescription"];
  },
) {
  return (
    stable(order.lines) === stable(content.lines) &&
    (order.customerId ?? null) === (content.customerId ?? null) &&
    stable(order.prescription ?? null) === stable(content.prescription ?? null)
  );
}
