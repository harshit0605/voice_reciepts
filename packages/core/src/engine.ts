import { commandSchema, approvalSchemas, type Command } from "./contracts";
import { commandFingerprint, sameFingerprint } from "./fingerprint";
import {
  type Actor,
  type State,
  type Invoice,
  type InvoiceLine,
  type Approval,
  type Payment,
} from "./types";
import { refundQuote, openRefundRequest } from "./returns";
import {
  closingReports,
  denominationTotal,
  eodSnapshot,
  lastClosedDrawer,
  openDrawerSession,
} from "./drawer";
import {
  D,
  quote,
  invoiceNumber,
  balance,
  expectedCash,
  totals,
  indiaDate,
  round,
  rupees,
} from "./money";
type ReturnLineInput = { index: number; quantity: string };
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function ensure(
  value: unknown,
  message: string,
  code = "INVALID",
): asserts value {
  if (!value) throw new DomainError(code, message);
}
const values = <T>(r: Record<string, T>) => Object.values(r);
export function execute(
  input: State,
  raw: unknown,
  actor: Actor,
  now = new Date().toISOString(),
): { state: State; result: unknown } {
  const cmd = commandSchema.parse(raw);
  const json = JSON.stringify(cmd);
  ensure(actor.businessId === input.businessId, "Wrong business", "FORBIDDEN");
  const prior = input.commands[cmd.id];
  if (prior) {
    ensure(
      sameFingerprint(prior.fingerprint, json) && prior.actorId === actor.id,
      "Command ID was reused with different data",
      "CONFLICT",
    );
    return { state: input, result: prior.result };
  }
  const member = input.members[actor.id];
  ensure(member?.active || actor.recovery, "Account disabled", "FORBIDDEN");
  ensure(
    !member?.mustChangePassword || actor.recovery,
    "Replace your temporary password",
    "FORBIDDEN",
  );
  const s = structuredClone(input);
  const op = cmd.operation;
  const offline = op.type === "offline.checkout";
  const age = Date.parse(now) - Date.parse(cmd.occurredAt);
  ensure(age >= -120_000, "Transaction is in the future");
  if (
    !offline &&
    !actor.recovery &&
    !["camera.observe", "coverage.gap"].includes(op.type)
  )
    ensure(age < 300_000, "Online command expired");
  const owner = () =>
    ensure(actor.role === "owner", "Owner approval required", "FORBIDDEN");
  const collector = () =>
    ensure(actor.canCollect, "Payment collection is not enabled", "FORBIDDEN");
  // Anyone who takes money can open, count and close the shared drawer; each act carries their name.
  const drawerHand = () =>
    ensure(
      actor.role === "owner" || actor.canCollect,
      "Drawer access needs payment collection",
      "FORBIDDEN",
    );
  const counted = (paise: number, d?: Record<string, number>) => {
    if (d)
      ensure(
        denominationTotal(d) === paise,
        "The note count does not add up to the total",
      );
  };
  const audit = (action: string, referenceId: string, detail = "") => {
    const id = `${cmd.id}:audit:${Object.keys(s.audit).length}`;
    s.audit[id] = {
      id,
      actorId: actor.id,
      action,
      referenceId,
      detail,
      occurredAt: now,
    };
  };
  const review = (
    kind: State["reviews"][string]["kind"],
    referenceId: string,
    title: string,
    detail: string,
  ) => {
    const id = `${cmd.id}:review:${Object.keys(s.reviews).length}`;
    s.reviews[id] = {
      id,
      kind,
      referenceId,
      title,
      detail,
      createdAt: now,
      status: "open",
    };
  };
  const getOrder = (id: string, version?: number) => {
    const o = s.orders[id];
    ensure(o, "Order not found", "NOT_FOUND");
    ensure(o.status !== "completed", "Order already completed", "CONFLICT");
    ensure(o.status !== "cancelled", "Order was cancelled", "CONFLICT");
    if (version !== undefined)
      ensure(
        o.version === version,
        "Order changed; refresh before continuing",
        "CONFLICT",
      );
    return o;
  };
  const openDrawer = (at = cmd.occurredAt) => {
    const drawer = values(s.drawers).find(
      (d) => d.openedAt <= at && (!d.closedAt || d.closedAt >= at),
    );
    ensure(drawer, "Open a cash drawer before collecting cash");
    return drawer.id;
  };
  const useApproval = (
    id: string | undefined,
    kind: Approval["kind"],
    expected?: Record<string, unknown>,
  ) => {
    const a = id ? s.approvals[id] : undefined;
    ensure(
      a && a.status === "approved" && a.kind === kind,
      "An unused owner approval is required",
      "FORBIDDEN",
    );
    if (expected)
      for (const [key, value] of Object.entries(expected))
        ensure(
          a.payload[key] === value,
          "Approval does not match this transaction",
          "FORBIDDEN",
        );
    a.status = "used";
    return a;
  };
  const payment = (id: string, p: Omit<Payment, "id">) => {
    if (p.method === "upi") {
      ensure(p.reference?.trim(), "Enter a merchant-verified UPI reference");
      const ref = p.reference!.trim().toUpperCase();
      ensure(
        !values(s.payments).some((x) => x.reference === ref),
        "UPI reference already recorded",
        "PAYMENT_REFERENCE_REUSED",
      );
      p.reference = ref;
    }
    s.payments[id] = { id, ...p };
  };
  const move = (
    batchId: string,
    quantity: string,
    kind: State["stock"][string]["kind"],
    referenceId: string,
    reason: string,
    quarantineDelta = "0",
  ) => {
    const batch = s.batches[batchId];
    ensure(batch, "Batch not found");
    batch.quantity = D(batch.quantity).plus(quantity).toFixed();
    batch.quarantined = D(batch.quarantined).plus(quarantineDelta).toFixed();
    ensure(D(batch.quarantined).gte(0), "Quarantine stock cannot be negative");
    const id = `${cmd.id}:stock:${Object.keys(s.stock).length}`;
    s.stock[id] = {
      id,
      batchId,
      quantity,
      quarantineDelta,
      kind,
      referenceId,
      reason,
      actorId: actor.id,
      occurredAt: cmd.occurredAt,
    };
  };
  const quoteRefund = (invoice: Invoice, lines: ReturnLineInput[]) => {
    try {
      return refundQuote(s, invoice, lines);
    } catch (e) {
      throw new DomainError("INVALID", (e as Error).message);
    }
  };
  let result: unknown = { ok: true };
  switch (op.type) {
    case "product.save": {
      owner();
      ensure(
        op.product.units[op.product.baseUnit] === "1",
        "Base unit conversion must be 1",
      );
      const existing = s.products[op.product.id];
      if (
        existing &&
        values(s.batches).some((b) => b.productId === existing.id)
      )
        ensure(
          existing.baseUnit === op.product.baseUnit &&
            JSON.stringify(existing.units) === JSON.stringify(op.product.units),
          "Create a new product to change stocked unit conversions",
        );
      s.products[op.product.id] = op.product;
      result = op.product;
      break;
    }
    case "catalogue.import": {
      owner();
      const ids = new Set<string>();
      for (const p of op.products) {
        ensure(!ids.has(p.id), "Product repeated in import", "CONFLICT");
        ids.add(p.id);
        ensure(
          !s.products[p.id],
          `${p.name}: product ID already exists`,
          "CONFLICT",
        );
        ensure(
          p.units[p.baseUnit] === "1",
          `${p.name}: base unit conversion must be 1`,
        );
        s.products[p.id] = p;
      }
      audit("catalogue.import", op.importId, `${op.products.length} products`);
      // Keep the stored receipt small; the products themselves are in the catalogue.
      result = { importId: op.importId, created: op.products.length };
      break;
    }
    case "customer.create":
      ensure(!s.customers[op.customer.id], "Customer exists", "CONFLICT");
      s.customers[op.customer.id] = op.customer;
      result = op.customer;
      break;
    case "supplier.save":
      owner();
      s.suppliers[op.supplier.id] = op.supplier;
      result = op.supplier;
      break;
    case "batch.price": {
      owner();
      const b = s.batches[op.batchId];
      ensure(b, "Batch missing");
      ensure(op.pricePaise <= b.mrpPaise, "Selling price cannot exceed MRP");
      const previous = b.pricePaise;
      b.pricePaise = op.pricePaise;
      audit(
        "batch.price",
        b.id,
        `${previous} → ${op.pricePaise}: ${op.reason}`,
      );
      break;
    }
    case "stock.opening": {
      owner();
      ensure(s.products[op.batch.productId], "Product missing");
      ensure(
        !s.batches[op.batch.id],
        "Batch exists; request an adjustment",
        "CONFLICT",
      );
      ensure(op.batch.pricePaise <= op.batch.mrpPaise, "Price exceeds MRP");
      const code = op.batch.code.trim().toUpperCase();
      ensure(
        !values(s.batches).some(
          (b) =>
            b.productId === op.batch.productId &&
            b.code.trim().toUpperCase() === code,
        ),
        "This batch is already in stock. Use a stock adjustment to correct its count.",
        "CONFLICT",
      );
      s.batches[op.batch.id] = { ...op.batch, quantity: "0", quarantined: "0" };
      move(op.batch.id, op.batch.quantity, "opening", op.batch.id, op.reason);
      result = s.batches[op.batch.id];
      break;
    }
    case "order.save": {
      const old = s.orders[op.orderId];
      if (old) {
        getOrder(op.orderId, op.version);
        ensure(
          old.collectorId === actor.id && old.status === "held",
          "Only the current collector can edit this order",
          "FORBIDDEN",
        );
      } else ensure(op.version === 0, "Invalid initial version");
      if (op.customerId) ensure(s.customers[op.customerId], "Customer missing");
      quote(s, op.lines, cmd.occurredAt);
      s.orders[op.orderId] = {
        id: op.orderId,
        lines: op.lines,
        customerId: op.customerId,
        dispenserId: old?.dispenserId ?? actor.id,
        collectorId: actor.id,
        counterId: op.counterId,
        version: (old?.version ?? 0) + 1,
        status: "held",
        createdAt: old?.createdAt ?? cmd.occurredAt,
        prescription: op.prescription,
      };
      result = s.orders[op.orderId];
      break;
    }
    case "order.offer": {
      const o = getOrder(op.orderId, op.version);
      ensure(
        o.collectorId === actor.id && o.status === "held",
        "You do not hold this order",
        "FORBIDDEN",
      );
      ensure(
        s.members[op.to]?.active && s.members[op.to]?.canCollect,
        "Recipient cannot collect",
      );
      o.status = "handoff";
      o.offeredTo = op.to;
      o.version++;
      result = o;
      break;
    }
    case "order.accept": {
      const o = getOrder(op.orderId, op.version);
      ensure(
        o.status === "handoff" && o.offeredTo === actor.id,
        "This handoff is not addressed to you",
        "FORBIDDEN",
      );
      collector();
      o.collectorId = actor.id;
      o.status = "held";
      delete o.offeredTo;
      o.version++;
      result = o;
      break;
    }
    case "order.decline": {
      const o = getOrder(op.orderId, op.version);
      ensure(
        o.status === "handoff" && o.offeredTo === actor.id,
        "This handoff is not addressed to you",
        "FORBIDDEN",
      );
      o.status = "held";
      delete o.offeredTo;
      o.version++;
      result = o;
      break;
    }
    case "order.recall": {
      const o = getOrder(op.orderId, op.version);
      ensure(
        (o.status === "handoff" && o.collectorId === actor.id) ||
          actor.role === "owner",
        "Only the offering collector or an owner can take this order back",
        "FORBIDDEN",
      );
      collector();
      const from = o.offeredTo ?? o.collectorId;
      o.collectorId = actor.id;
      o.status = "held";
      delete o.offeredTo;
      o.version++;
      audit("order.recall", o.id, `from ${from}`);
      result = o;
      break;
    }
    case "order.cancel": {
      const o = getOrder(op.orderId, op.version);
      ensure(
        o.status === "held",
        "Take back a handed-off order before cancelling it",
        "CONFLICT",
      );
      ensure(
        o.collectorId === actor.id || actor.role === "owner",
        "Only the current collector or an owner can cancel this order",
        "FORBIDDEN",
      );
      o.status = "cancelled";
      o.cancelReason = op.reason;
      o.cancelledAt = cmd.occurredAt;
      o.cancelledBy = actor.id;
      o.version++;
      audit("order.cancel", o.id, op.reason);
      result = o;
      break;
    }
    case "checkout":
    case "offline.checkout": {
      collector();
      ensure(
        s.settings.readinessConfirmed,
        "Complete business and billing readiness setup first",
      );
      const device = s.devices[op.deviceId];
      ensure(
        device && device.userId === actor.id,
        "Device is not assigned to you",
        "FORBIDDEN",
      );
      ensure(!device.revoked || actor.recovery, "Device revoked", "FORBIDDEN");
      if (offline) {
        ensure(
          actor.offlineAuthorized || actor.recovery,
          "Signed offline authorisation required",
          "FORBIDDEN",
        );
        ensure(
          op.dispenserId === actor.id,
          "Offline sale must remain on the originating device",
        );
        ensure(
          !s.orders[op.orderId] || s.orders[op.orderId].status === "held",
          "Order already completed or transferred",
          "CONFLICT",
        );
        if (s.orders[op.orderId])
          ensure(
            s.orders[op.orderId].collectorId === actor.id,
            "Order belongs to another collector",
            "FORBIDDEN",
          );
        s.orders[op.orderId] = {
          id: op.orderId,
          lines: op.lines,
          customerId: op.customerId,
          dispenserId: actor.id,
          collectorId: actor.id,
          counterId: op.counterId,
          version: 1,
          status: "held",
          createdAt: cmd.occurredAt,
          prescription: op.prescription,
        };
      }
      const o = getOrder(op.orderId, offline ? undefined : op.version);
      ensure(
        o.status === "held" && o.collectorId === actor.id,
        "Order not available to collect",
        "CONFLICT",
      );
      const discount = offline ? 0 : op.discountPaise;
      const credit = offline ? 0 : op.creditPaise;
      const upi = offline ? 0 : op.upiPaise;
      if (discount)
        useApproval(!offline ? op.discountApprovalId : undefined, "discount", {
          orderId: o.id,
          orderVersion: o.version,
          amountPaise: discount,
        });
      if (credit) {
        ensure(o.customerId, "Credit needs a customer");
        useApproval(!offline ? op.creditApprovalId : undefined, "credit", {
          orderId: o.id,
          orderVersion: o.version,
          customerId: o.customerId,
          amountPaise: credit,
        });
      }
      const lines = quote(
        s,
        o.lines,
        cmd.occurredAt,
        discount,
        offline ? op.lines : undefined,
      );
      const total = lines.reduce((n, l) => n + l.netPaise, 0);
      ensure(
        op.cashPaise + upi + credit === total,
        "Payment split must equal the invoice total",
      );
      const regulated = lines.some(
        (l) => s.products[l.productId].schedule !== "OTC",
      );
      if (regulated)
        ensure(o.prescription, "Prescription register details are required");
      ensure(
        !lines.some((l) => s.products[l.productId].schedule === "X"),
        "Schedule X sale is disabled until the shop-specific workflow is validated",
      );
      const combined = new Map<string, ReturnType<typeof D>>();
      for (const l of lines)
        combined.set(
          l.batchId,
          (combined.get(l.batchId) ?? D(0)).plus(l.baseQuantity),
        );
      for (const [batchId, quantity] of combined) {
        if (D(s.batches[batchId].quantity).lt(quantity)) {
          ensure(offline, "Insufficient stock");
          review(
            "offline_stock",
            o.id,
            "Offline stock conflict",
            `${s.batches[batchId].code}: sold ${quantity}, recorded stock ${s.batches[batchId].quantity}. Physical count required.`,
          );
        }
      }
      if (offline)
        for (const l of lines) {
          const b = s.batches[l.batchId],
            p = s.products[b.productId];
          if (l.pricePaise !== b.pricePaise || l.taxBps !== p.taxBps)
            review(
              "offline_price",
              o.id,
              "Offline price needs review",
              `Preserved the issued bill for ${p.name}; cached price or tax differs.`,
            );
        }
      const number = invoiceNumber(cmd.occurredAt, device.series, op.sequence);
      ensure(number.length <= 16, "Invoice series too long");
      ensure(
        !values(s.invoices).some((i) => i.number === number),
        "Invoice number already used",
        "INVOICE_NUMBER_USED",
      );
      const invoice: Invoice = {
        id: `${cmd.id}:invoice`,
        number,
        orderId: o.id,
        deviceId: device.id,
        customerId: o.customerId,
        dispenserId: o.dispenserId,
        collectorId: actor.id,
        counterId: o.counterId,
        occurredAt: cmd.occurredAt,
        postedAt: now,
        lines,
        grossPaise: lines.reduce((n, l) => n + l.grossPaise, 0),
        discountPaise: discount,
        totalPaise: total,
        taxPaise: lines.reduce((n, l) => n + l.taxPaise, 0),
        offline,
        prescription: o.prescription,
        business: structuredClone(s.settings),
      };
      s.invoices[invoice.id] = invoice;
      if (op.cashPaise)
        payment(`${cmd.id}:cash`, {
          invoiceId: invoice.id,
          customerId: o.customerId,
          kind: "sale",
          method: "cash",
          amountPaise: op.cashPaise,
          verification: "cash_counted",
          collectorId: actor.id,
          occurredAt: cmd.occurredAt,
          drawerId: openDrawer(),
        });
      if (upi && !offline) {
        ensure(op.upiVerified, "Verify payment in the merchant app first");
        payment(`${cmd.id}:upi`, {
          invoiceId: invoice.id,
          customerId: o.customerId,
          kind: "sale",
          method: "upi",
          amountPaise: upi,
          reference: op.upiReference,
          verification: "merchant_manually_verified",
          collectorId: actor.id,
          occurredAt: cmd.occurredAt,
        });
      }
      if (credit) {
        const id = `${cmd.id}:credit`;
        s.ledger[id] = {
          id,
          customerId: o.customerId!,
          invoiceId: invoice.id,
          amountPaise: credit,
          kind: "credit_sale",
          occurredAt: cmd.occurredAt,
        };
      }
      for (const l of lines)
        move(
          l.batchId,
          D(l.baseQuantity).neg().toFixed(),
          "sale",
          invoice.id,
          "Sale",
        );
      o.status = "completed";
      o.version++;
      result = invoice;
      break;
    }
    case "approval.request": {
      ensure(!s.approvals[op.approvalId], "Approval exists", "CONFLICT");
      const payload = approvalSchemas[op.kind].parse(op.payload);
      if (op.kind === "credit" || op.kind === "discount") {
        const p = payload as { orderId: string; orderVersion: number };
        const order = getOrder(p.orderId, p.orderVersion);
        ensure(
          order.collectorId === actor.id || actor.role === "owner",
          "Order not assigned to you",
          "FORBIDDEN",
        );
      }
      if (op.kind === "refund") {
        const p = payload as { invoiceId: string; lines: ReturnLineInput[] };
        const invoice = s.invoices[p.invoiceId];
        ensure(invoice, "Invoice missing");
        // Checked now, so the owner is never asked to approve a return that cannot be paid out.
        quoteRefund(invoice, p.lines);
        ensure(
          !values(s.approvals).some((a) => openRefundRequest(a, invoice.id)),
          "A return for this bill is already waiting for the owner",
          "CONFLICT",
        );
      }
      if (op.kind === "stock")
        ensure(
          s.batches[(payload as { batchId: string }).batchId],
          "Batch missing",
        );
      s.approvals[op.approvalId] = {
        id: op.approvalId,
        kind: op.kind,
        payload,
        requestedBy: actor.id,
        requestedAt: now,
        status: "pending",
        reason: op.reason,
      };
      result = s.approvals[op.approvalId];
      break;
    }
    case "approval.decide": {
      owner();
      const a = s.approvals[op.approvalId];
      ensure(a?.status === "pending", "Approval is not pending");
      a.status = op.approve ? "approved" : "rejected";
      a.decidedBy = actor.id;
      a.decidedAt = now;
      result = a;
      break;
    }
    case "refund.execute": {
      // The owner, or the employee who asked, hands the money back once the owner has approved.
      const request = s.approvals[op.approvalId];
      ensure(
        actor.role === "owner" ||
          (request?.requestedBy === actor.id && actor.canCollect),
        "Owner approval required",
        "FORBIDDEN",
      );
      const a = useApproval(op.approvalId, "refund");
      const p = approvalSchemas.refund.parse(a.payload);
      const invoice = s.invoices[p.invoiceId];
      ensure(invoice, "Invoice missing");
      const quoted = quoteRefund(invoice, p.lines);
      for (const l of p.lines)
        move(
          invoice.lines[l.index].batchId,
          "0",
          "return",
          invoice.id,
          "Returned stock quarantined",
          l.quantity,
        );
      const total = quoted.totalPaise,
        reduction = quoted.creditReductionPaise;
      ensure(
        op.cashPaise + op.upiPaise === quoted.payablePaise,
        `Refund ${rupees(quoted.payablePaise)}${reduction ? ` (${rupees(reduction)} is taken off what the customer owes)` : ""}`,
      );
      if (reduction) {
        const id = `cmd:${cmd.id}:credit-return`;
        s.ledger[id] = {
          id,
          customerId: invoice.customerId!,
          invoiceId: invoice.id,
          amountPaise: -reduction,
          kind: "credit_return",
          occurredAt: cmd.occurredAt,
        };
      }
      if (op.cashPaise)
        payment(`${cmd.id}:refund-cash`, {
          invoiceId: invoice.id,
          kind: "refund",
          method: "cash",
          amountPaise: op.cashPaise,
          verification: "cash_counted",
          collectorId: actor.id,
          occurredAt: cmd.occurredAt,
          drawerId: openDrawer(),
        });
      if (op.upiPaise)
        payment(`${cmd.id}:refund-upi`, {
          invoiceId: invoice.id,
          kind: "refund",
          method: "upi",
          amountPaise: op.upiPaise,
          reference: op.upiReference,
          verification: "merchant_manually_verified",
          collectorId: actor.id,
          occurredAt: cmd.occurredAt,
        });
      const id = `${cmd.id}:refund`;
      s.refunds[id] = {
        id,
        invoiceId: invoice.id,
        approvalId: a.id,
        lines: p.lines,
        totalPaise: total,
        creditReductionPaise: reduction,
        cashRefundPaise: op.cashPaise,
        upiRefundPaise: op.upiPaise,
        executedBy: actor.id,
        occurredAt: cmd.occurredAt,
      };
      result = s.refunds[id];
      break;
    }
    case "stock.execute": {
      owner();
      const a = useApproval(op.approvalId, "stock");
      const p = approvalSchemas.stock.parse(a.payload);
      const b = s.batches[p.batchId];
      ensure(b, "Batch missing");
      if (p.kind === "quarantine_disposal") {
        ensure(
          D(p.quantity).lt(0) && D(b.quarantined).plus(p.quantity).gte(0),
          "Invalid quarantine disposal",
        );
        move(b.id, "0", "damage", a.id, p.reason, p.quantity);
      } else if (p.kind === "release") {
        ensure(
          D(p.quantity).gt(0) && D(b.quarantined).gte(p.quantity),
          "Invalid quarantine release",
        );
        ensure(
          b.expiry >= indiaDate(now),
          "Expired returns cannot be released",
        );
        move(
          b.id,
          p.quantity,
          "release",
          a.id,
          p.reason,
          D(p.quantity).neg().toFixed(),
        );
      } else {
        if (p.kind !== "correction")
          ensure(D(p.quantity).lt(0), "This operation must reduce stock");
        ensure(
          D(b.quantity).plus(p.quantity).gte(0),
          "Adjustment would make stock negative",
        );
        move(b.id, p.quantity, p.kind, a.id, p.reason);
      }
      break;
    }
    case "drawer.open": {
      drawerHand();
      ensure(!openDrawerSession(s), "A drawer session is already open");
      ensure(!s.drawers[op.drawerId], "Drawer session exists");
      counted(op.openingPaise, op.denominations);
      const previous = lastClosedDrawer(s);
      s.drawers[op.drawerId] = {
        id: op.drawerId,
        openingPaise: op.openingPaise,
        openedAt: cmd.occurredAt,
        openedBy: actor.id,
        ...(op.denominations ? { openingDenominations: op.denominations } : {}),
        // Cash left overnight should be what the next person finds.
        ...(previous?.keptPaise !== undefined
          ? { openingDifferencePaise: op.openingPaise - previous.keptPaise }
          : {}),
      };
      // Staff are answered without the figures they must not see.
      result =
        actor.role === "owner"
          ? s.drawers[op.drawerId]
          : { id: op.drawerId, openingPaise: op.openingPaise };
      break;
    }
    case "drawer.count": {
      drawerHand();
      const d = s.drawers[op.drawerId];
      ensure(d && !d.closedAt, "Drawer not open");
      counted(op.countedPaise, op.denominations);
      const expected = expectedCash(s, d.id);
      d.checks = [
        ...(d.checks ?? []),
        {
          at: cmd.occurredAt,
          by: actor.id,
          countedPaise: op.countedPaise,
          expectedPaise: expected,
          differencePaise: op.countedPaise - expected,
          ...(op.denominations ? { denominations: op.denominations } : {}),
          ...(op.note ? { note: op.note } : {}),
        },
      ];
      result =
        actor.role === "owner"
          ? d.checks.at(-1)
          : { countedPaise: op.countedPaise };
      break;
    }
    case "drawer.close": {
      drawerHand();
      const d = s.drawers[op.drawerId];
      ensure(d && !d.closedAt, "Drawer not open");
      counted(op.countedPaise, op.denominations);
      ensure(
        op.keptPaise === undefined || op.keptPaise <= op.countedPaise,
        "Cash left in the drawer cannot be more than was counted",
      );
      d.closedAt = cmd.occurredAt;
      d.closedBy = actor.id;
      d.countedPaise = op.countedPaise;
      if (op.keptPaise !== undefined) d.keptPaise = op.keptPaise;
      if (op.denominations) d.closingDenominations = op.denominations;
      d.expectedAtClose = expectedCash(s, d.id);
      d.discrepancyPaise = op.countedPaise - d.expectedAtClose;
      // Closing the last drawer closes the day: the owner gets a report for each day it was open.
      if (!openDrawerSession(s))
        for (const eod of closingReports(
          s,
          indiaDate(d.openedAt),
          indiaDate(cmd.occurredAt),
          now,
        ))
          s.eods[eod.id] = eod;
      result =
        actor.role === "owner"
          ? {
              countedPaise: d.countedPaise,
              expectedPaise: d.expectedAtClose,
              differencePaise: d.discrepancyPaise,
            }
          : { countedPaise: op.countedPaise };
      break;
    }
    case "cash.move": {
      drawerHand();
      ensure(
        s.drawers[op.drawerId] && !s.drawers[op.drawerId].closedAt,
        "Drawer not open",
      );
      s.cash[cmd.id] = {
        id: cmd.id,
        drawerId: op.drawerId,
        kind: op.kind,
        amountPaise: op.amountPaise,
        reason: op.reason,
        actorId: actor.id,
        occurredAt: cmd.occurredAt,
      };
      break;
    }
    case "credit.repay": {
      collector();
      ensure(s.customers[op.customerId], "Customer missing");
      ensure(
        op.amountPaise > 0 && op.amountPaise <= balance(s, op.customerId),
        "Repayment exceeds customer dues",
      );
      if (op.method === "upi")
        ensure(op.verified, "Verify payment in merchant app");
      let remaining = op.amountPaise;
      const credits = values(s.ledger)
        .filter(
          (l) => l.customerId === op.customerId && l.kind === "credit_sale",
        )
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      for (const credit of credits) {
        const due = values(s.ledger)
          .filter((l) => l.invoiceId === credit.invoiceId)
          .reduce((n, l) => n + l.amountPaise, 0);
        const applied = Math.min(remaining, Math.max(0, due));
        if (applied) {
          const id = `${cmd.id}:repay:${credit.invoiceId}`;
          s.ledger[id] = {
            id,
            customerId: op.customerId,
            invoiceId: credit.invoiceId,
            amountPaise: -applied,
            kind: "repayment",
            occurredAt: cmd.occurredAt,
          };
          remaining -= applied;
        }
      }
      ensure(remaining === 0, "Credit ledger is inconsistent");
      payment(`${cmd.id}:payment`, {
        customerId: op.customerId,
        kind: "repayment",
        method: op.method,
        amountPaise: op.amountPaise,
        reference: op.reference,
        verification:
          op.method === "cash" ? "cash_counted" : "merchant_manually_verified",
        collectorId: actor.id,
        occurredAt: cmd.occurredAt,
        drawerId: op.method === "cash" ? openDrawer() : undefined,
      });
      break;
    }
    case "purchase.post": {
      owner();
      ensure(s.suppliers[op.supplierId], "Supplier missing");
      ensure(
        !s.purchases[op.purchaseId],
        "Purchase ID already posted",
        "CONFLICT",
      );
      ensure(
        op.invoiceNumber.trim().length > 0,
        "Supplier invoice number is required",
      );
      ensure(
        op.invoiceDate <= indiaDate(now),
        "Invoice date cannot be in the future",
      );
      ensure(
        new Set(op.lines.map((l) => l.batch.id)).size === op.lines.length,
        "Use distinct stock lots for each invoice line",
      );
      ensure(
        !op.documentId ||
          !values(s.purchases).some((p) => p.documentId === op.documentId),
        "This source document already has a posted purchase",
        "CONFLICT",
      );
      ensure(
        !values(s.purchases).some(
          (p) =>
            p.supplierId === op.supplierId &&
            p.invoiceNumber.trim().toUpperCase() ===
              op.invoiceNumber.trim().toUpperCase(),
        ),
        "Supplier invoice already posted",
        "CONFLICT",
      );
      ensure(
        op.lines.reduce((n, l) => n + l.lineTotalPaise, 0) +
          (op.adjustmentPaise ?? 0) ===
          op.totalPaise,
        "Purchase lines must reconcile to invoice total",
      );
      ensure(
        !op.adjustmentPaise || (op.adjustmentReason ?? "").trim().length >= 3,
        "Invoice adjustment requires a reason",
      );
      for (const line of op.lines) {
        const b = line.batch;
        ensure(
          s.products[b.productId],
          "Map every line to a catalogue product",
        );
        const product = s.products[b.productId];
        ensure(product.active, "Cannot receive an inactive product");
        ensure(
          b.expiry >= indiaDate(now),
          "Expired stock cannot be received as sellable stock",
        );
        ensure(
          !b.verifiedCost || b.costPaise !== undefined,
          "Verified cost requires an amount",
        );
        ensure(
          b.quantity === "0" && b.quarantined === "0",
          "Purchase quantities belong in received quantities",
        );
        for (const amount of [line.quantity, line.bonusQuantity]) {
          ensure(
            ["g", "kg", "ml", "l"].includes(product.baseUnit.toLowerCase()) ||
              D(amount).isInteger(),
            "Received stock must contain whole base units",
          );
        }
        if (line.receiving) {
          const r = line.receiving;
          ensure(
            product.units[r.unit] === r.baseUnitsPerUnit &&
              product.units[r.priceUnit] === r.baseUnitsPerPriceUnit,
            "Pack conversion changed; review the item again",
            "CONFLICT",
          );
          ensure(
            D(r.quantity).mul(r.baseUnitsPerUnit).eq(line.quantity) &&
              D(r.bonusQuantity).mul(r.baseUnitsPerUnit).eq(line.bonusQuantity),
            "Received pack conversion does not match base quantity",
          );
        }
        ensure(b.pricePaise <= b.mrpPaise, "Selling price exceeds MRP");
        const old = s.batches[b.id];
        if (old)
          ensure(
            old.code === b.code &&
              old.productId === b.productId &&
              old.expiry === b.expiry &&
              old.pricePaise === b.pricePaise &&
              old.mrpPaise === b.mrpPaise &&
              old.verifiedCost === b.verifiedCost &&
              old.costPaise === b.costPaise,
            "Batch details differ; use a separate stock lot",
          );
        else s.batches[b.id] = { ...b, quantity: "0", quarantined: "0" };
        const quantity = D(line.quantity).plus(line.bonusQuantity);
        ensure(quantity.gt(0), "Received quantity must be positive");
        move(
          b.id,
          quantity.toFixed(),
          "purchase",
          op.purchaseId,
          "Supplier invoice received and reviewed",
        );
      }
      s.purchases[op.purchaseId] = {
        id: op.purchaseId,
        supplierId: op.supplierId,
        invoiceNumber: op.invoiceNumber.trim(),
        invoiceDate: op.invoiceDate,
        documentId: op.documentId,
        adjustmentPaise: op.adjustmentPaise,
        adjustmentReason: op.adjustmentReason,
        totalPaise: op.totalPaise,
        lines: op.lines,
        postedBy: actor.id,
        postedAt: now,
      };
      result = s.purchases[op.purchaseId];
      break;
    }
    case "review.resolve": {
      owner();
      const r = s.reviews[op.reviewId];
      ensure(r, "Review missing");
      ensure(
        r.kind !== "quarantined_command",
        "Resolve quarantined commands through recovery",
      );
      r.status = "resolved";
      r.resolvedBy = actor.id;
      r.resolution = op.resolution;
      break;
    }
    case "eod.close": {
      owner();
      const eod = eodSnapshot(s, op.date, now);
      s.eods[eod.id] = eod;
      result = eod;
      break;
    }
    case "device.revoke": {
      owner();
      ensure(s.devices[op.deviceId], "Device missing");
      s.devices[op.deviceId].revoked = true;
      break;
    }
    case "settings.update": {
      owner();
      ensure(
        op.settings.gstin.slice(0, 2) === op.settings.stateCode,
        "GSTIN and state code differ",
      );
      s.settings = { ...s.settings, ...op.settings };
      break;
    }
    case "camera.observe": {
      owner();
      const o = op.observation;
      ensure(!s.observations[o.id], "Observation already received", "CONFLICT");
      ensure(o.endedAt >= o.startedAt, "Invalid interaction interval");
      const candidateInvoiceIds = values(s.invoices)
        .filter(
          (i) =>
            i.counterId === o.counterId &&
            Date.parse(i.occurredAt) >= Date.parse(o.startedAt) - 60_000 &&
            Date.parse(i.occurredAt) <= Date.parse(o.endedAt) + 120_000,
        )
        .map((i) => i.id);
      s.observations[o.id] = {
        ...o,
        candidateInvoiceIds,
        association:
          candidateInvoiceIds.length === 0
            ? "unmatched"
            : candidateInvoiceIds.length === 1
              ? "candidate"
              : "ambiguous",
      };
      if (candidateInvoiceIds.length !== 1)
        review(
          "camera",
          o.id,
          candidateInvoiceIds.length
            ? "Ambiguous counter interaction"
            : "Interaction without a matched bill",
          "Silent pilot observation; a purchase and employee identity are not established.",
        );
      result = s.observations[o.id];
      break;
    }
    case "coverage.gap":
      owner();
      review("coverage", op.source, "Monitoring coverage gap", op.detail);
      break;
  }
  // A late financial change appends an EOD revision and never overwrites the old snapshot.
  if (
    [
      "checkout",
      "offline.checkout",
      "credit.repay",
      "refund.execute",
      "cash.move",
    ].includes(op.type)
  ) {
    const date = indiaDate(cmd.occurredAt);
    const latest = values(s.eods)
      .filter((e) => e.date === date)
      .sort((a, b) => b.revision - a.revision)[0];
    // Only something that happened before the report but arrived after it (an offline sale synced
    // late) revises it. Trading after the report is picked up when the day is closed again.
    if (latest && cmd.occurredAt <= (latest.syncCutoffAt ?? latest.createdAt)) {
      const eod = eodSnapshot(s, date, now);
      s.eods[eod.id] = eod;
      review(
        "late_transaction",
        cmd.id,
        "EOD report revised",
        `A transaction updated ${date}; revision ${eod.revision} preserves earlier reports.`,
      );
    }
    for (const observation of values(s.observations)) {
      const candidates = values(s.invoices)
        .filter(
          (i) =>
            i.counterId === observation.counterId &&
            Date.parse(i.occurredAt) >=
              Date.parse(observation.startedAt) - 60_000 &&
            Date.parse(i.occurredAt) <=
              Date.parse(observation.endedAt) + 120_000,
        )
        .map((i) => i.id);
      observation.candidateInvoiceIds = candidates;
      observation.association =
        candidates.length === 0
          ? "unmatched"
          : candidates.length === 1
            ? "candidate"
            : "ambiguous";
      if (candidates.length === 1)
        for (const r of values(s.reviews).filter(
          (r) =>
            r.kind === "camera" &&
            r.referenceId === observation.id &&
            r.status === "open",
        )) {
          r.status = "resolved";
          r.resolution =
            "A candidate bill arrived after synchronisation; association remains subject to review.";
        }
    }
  }
  audit(op.type, cmd.id);
  s.revision++;
  s.commands[cmd.id] = {
    id: cmd.id,
    fingerprint: commandFingerprint(json),
    result,
    actorId: actor.id,
    revision: s.revision,
  };
  return { state: s, result };
}
export function employeeView(state: State, userId: string): State {
  const s = structuredClone(state);
  for (const b of values(s.batches)) {
    delete b.costPaise;
    b.verifiedCost = false;
  }
  s.suppliers = {};
  s.purchases = {};
  s.eods = {};
  // Staff count the drawer blind: they never see what it should hold or how far off it was.
  for (const d of values(s.drawers)) {
    delete d.expectedAtClose;
    delete d.discrepancyPaise;
    delete d.openingDifferencePaise;
    delete d.keptPaise;
    d.checks = (d.checks ?? [])
      .filter((c) => c.by === userId)
      .map(({ expectedPaise, differencePaise, ...c }) => c) as typeof d.checks;
  }
  s.cash = Object.fromEntries(
    values(s.cash)
      .filter((m) => m.actorId === userId)
      .map((m) => [m.id, m]),
  );
  for (const m of values(s.members)) if (m.id !== userId) delete m.username;
  for (const d of values(s.devices))
    if (d.userId !== userId) {
      delete d.pushToken;
      delete d.pushPlatform;
      delete d.pushLanguage;
    }
  s.audit = {};
  s.reviews = {};
  s.observations = {};
  s.quarantine = {};
  s.commands = {};
  s.invoices = Object.fromEntries(
    values(s.invoices)
      .filter((i) => i.collectorId === userId || i.dispenserId === userId)
      .map((i) => [
        i.id,
        { ...i, lines: i.lines.map(({ costPaise, ...l }) => l) },
      ]),
  );
  s.approvals = Object.fromEntries(
    values(s.approvals)
      .filter((a) => a.requestedBy === userId)
      .map((a) => [a.id, a]),
  );
  s.orders = Object.fromEntries(
    values(s.orders)
      .filter(
        (o) =>
          o.collectorId === userId ||
          o.dispenserId === userId ||
          o.offeredTo === userId,
      )
      .map((o) => [o.id, o]),
  );
  s.payments = Object.fromEntries(
    values(s.payments)
      .filter((p) => p.collectorId === userId)
      .map((p) => [p.id, p]),
  );
  s.devices = Object.fromEntries(
    values(s.devices)
      .filter((d) => d.userId === userId)
      .map((d) => [d.id, d]),
  );
  s.stock = {};
  // Returns on bills this employee can see, so the phone knows what already came back.
  s.refunds = Object.fromEntries(
    values(s.refunds)
      .filter((r) => s.invoices[r.invoiceId])
      .map((r) => [r.id, r]),
  );
  return s;
}
