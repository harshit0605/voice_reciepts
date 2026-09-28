import { z } from "zod";
import { invoiceDraftSchema } from "./receiving";
const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const money = z.number().int().min(0).max(100_000_000);
const qty = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/);
const positive = qty.refine((v) => Number(v) > 0, "Quantity must be positive");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
const line = z
  .object({
    batchId: id,
    quantity: positive,
    unit: z.string().min(1).max(30),
    confirmed: z.boolean(),
  })
  .strict();
const prescription = z.object({
  patient: z.string().min(1),
  address: z.string().min(1),
  prescriber: z.string().min(1),
  prescriberAddress: z.string().min(1),
  reference: z.string().min(1),
});
const product = z
  .object({
    id,
    name: z.string().min(1).max(180),
    generic: z.string().max(180),
    strength: z.string().max(60),
    form: z.string().max(60),
    hsn: z.string().max(12),
    aliases: z.array(z.string().max(100)).max(30),
    barcode: z.string().max(60),
    units: z.record(z.string(), positive),
    baseUnit: z.string().min(1),
    taxBps: z.number().int().min(0).max(10000),
    reorderAt: qty,
    schedule: z.enum(["OTC", "H", "H1", "X"]),
    active: z.boolean(),
  })
  .strict();
const batch = z
  .object({
    id,
    productId: id,
    code: z.string().min(1).max(80),
    expiry: date,
    quantity: qty,
    quarantined: qty,
    pricePaise: money,
    mrpPaise: money,
    costPaise: money.optional(),
    verifiedCost: z.boolean(),
  })
  .strict();
const approvalPayload = z.record(z.string(), z.unknown());
const data = z.discriminatedUnion("type", [
  z.object({ type: z.literal("product.save"), product }),
  z.object({
    type: z.literal("batch.price"),
    batchId: id,
    pricePaise: money,
    reason: z.string().min(3),
  }),
  z.object({
    type: z.literal("customer.create"),
    customer: z.object({
      id,
      name: z.string().min(1).max(120),
      phone: z.string().max(20),
      address: z.string().max(400),
    }),
  }),
  z.object({
    type: z.literal("supplier.save"),
    supplier: z.object({
      id,
      name: z.string().min(1),
      gstin: z.string(),
      phone: z.string(),
    }),
  }),
  z.object({
    type: z.literal("stock.opening"),
    batch,
    reason: z.string().min(3),
  }),
  z.object({
    type: z.literal("order.save"),
    orderId: id,
    version: z.number().int().min(0),
    lines: z.array(line).min(1).max(100),
    customerId: id.optional(),
    counterId: id,
    prescription: prescription.optional(),
  }),
  z.object({
    type: z.literal("order.offer"),
    orderId: id,
    to: id,
    version: z.number().int(),
  }),
  z.object({
    type: z.literal("order.accept"),
    orderId: id,
    version: z.number().int(),
  }),
  z.object({
    type: z.literal("order.decline"),
    orderId: id,
    version: z.number().int(),
  }),
  /** The offering collector takes back a handoff; an owner may take over any open order. */
  z.object({
    type: z.literal("order.recall"),
    orderId: id,
    version: z.number().int(),
  }),
  z.object({
    type: z.literal("order.cancel"),
    orderId: id,
    version: z.number().int(),
    reason: z.string().trim().min(3).max(300),
  }),
  z.object({
    type: z.literal("checkout"),
    orderId: id,
    version: z.number().int(),
    deviceId: id,
    sequence: z.number().int().positive().max(999999),
    cashPaise: money,
    upiPaise: money,
    upiReference: z.string().max(80).optional(),
    upiVerified: z.boolean().optional(),
    creditPaise: money,
    discountPaise: money,
    creditApprovalId: id.optional(),
    discountApprovalId: id.optional(),
  }),
  z.object({
    type: z.literal("offline.checkout"),
    deviceId: id,
    sequence: z.number().int().positive().max(999999),
    orderId: id,
    counterId: id,
    lines: z
      .array(
        line.extend({
          pricePaise: money,
          taxBps: z.number().int().min(0).max(10000),
        }),
      )
      .min(1)
      .max(100),
    customerId: id.optional(),
    cashPaise: money,
    dispenserId: id,
    prescription: prescription.optional(),
  }),
  z.object({
    type: z.literal("approval.request"),
    approvalId: id,
    kind: z.enum(["credit", "discount", "refund", "stock"]),
    payload: approvalPayload,
    reason: z.string().min(3).max(1000),
  }),
  z.object({
    type: z.literal("approval.decide"),
    approvalId: id,
    approve: z.boolean(),
  }),
  z.object({
    type: z.literal("refund.execute"),
    approvalId: id,
    cashPaise: money,
    upiPaise: money,
    upiReference: z.string().max(80).optional(),
  }),
  z.object({ type: z.literal("stock.execute"), approvalId: id }),
  z.object({
    type: z.literal("drawer.open"),
    drawerId: id,
    openingPaise: money,
  }),
  z.object({
    type: z.literal("drawer.close"),
    drawerId: id,
    countedPaise: money,
  }),
  z.object({
    type: z.literal("cash.move"),
    drawerId: id,
    kind: z.enum(["introduced", "withdrawal", "safe_transfer"]),
    amountPaise: money,
    reason: z.string().min(3),
  }),
  z.object({
    type: z.literal("credit.repay"),
    customerId: id,
    amountPaise: money,
    method: z.enum(["cash", "upi"]),
    reference: z.string().max(80).optional(),
    verified: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("purchase.post"),
    purchaseId: id,
    supplierId: id,
    invoiceNumber: z.string().min(1).max(80),
    invoiceDate: date,
    documentId: id.optional(),
    adjustmentPaise: z
      .number()
      .int()
      .min(-100_000_000)
      .max(100_000_000)
      .optional(),
    adjustmentReason: z.string().max(300).optional(),
    totalPaise: money,
    reviewed: z.literal(true),
    lines: z
      .array(
        z.object({
          batch,
          quantity: qty,
          bonusQuantity: qty,
          lineTotalPaise: money,
          source: invoiceDraftSchema.shape.lines.element.optional(),
          receiving: z
            .object({
              quantity: qty,
              bonusQuantity: qty,
              unit: z.string().min(1),
              baseUnitsPerUnit: positive,
              priceUnit: z.string().min(1),
              baseUnitsPerPriceUnit: positive,
            })
            .optional(),
        }),
      )
      .min(1)
      .max(500),
  }),
  z.object({
    type: z.literal("review.resolve"),
    reviewId: id,
    resolution: z.string().min(3).max(1000),
  }),
  z.object({ type: z.literal("eod.close"), date }),
  z.object({ type: z.literal("device.revoke"), deviceId: id }),
  z.object({
    type: z.literal("settings.update"),
    settings: z.object({
      name: z.string().min(1),
      address: z.string().min(1),
      gstin: z.string().regex(/^\d{2}[A-Z0-9]{13}$/),
      drugLicence: z.string().min(1),
      stateCode: z.string().regex(/^\d{2}$/),
      phone: z.string(),
      upiId: z.string(),
      gatewayUrl: z.string(),
      readinessConfirmed: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("camera.observe"),
    observation: z.object({
      id,
      counterId: id,
      trackId: id,
      startedAt: z.iso.datetime(),
      endedAt: z.iso.datetime(),
      clipId: id.optional(),
      visible: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("coverage.gap"),
    source: z.string().min(1),
    detail: z.string().min(1),
  }),
]);
export const commandSchema = z
  .object({ id, occurredAt: z.iso.datetime(), operation: data })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export type Operation = Command["operation"];
export const approvalSchemas = {
  credit: z
    .object({
      orderId: id,
      orderVersion: z.number().int(),
      customerId: id,
      amountPaise: money,
    })
    .strict(),
  discount: z
    .object({ orderId: id, orderVersion: z.number().int(), amountPaise: money })
    .strict(),
  refund: z
    .object({
      invoiceId: id,
      lines: z
        .array(z.object({ index: z.number().int().min(0), quantity: positive }))
        .min(1),
    })
    .strict(),
  stock: z
    .object({
      batchId: id,
      quantity: z.string().regex(/^-?(0|[1-9]\d{0,8})(\.\d{1,3})?$/),
      kind: z.enum([
        "correction",
        "supplier_return",
        "damage",
        "expiry",
        "release",
        "quarantine_disposal",
      ]),
      reason: z.string().min(3),
    })
    .strict(),
};
