export type Role = "owner" | "employee";
export type Entity = { id: string };
export type Product = Entity & {
  name: string;
  generic: string;
  strength: string;
  form: string;
  hsn: string;
  aliases: string[];
  barcode: string;
  units: Record<string, string>;
  baseUnit: string;
  taxBps: number;
  reorderAt: string;
  schedule: "OTC" | "H" | "H1" | "X";
  active: boolean;
};
export type Batch = Entity & {
  productId: string;
  code: string;
  expiry: string;
  quantity: string;
  quarantined: string;
  pricePaise: number;
  mrpPaise: number;
  costPaise?: number;
  verifiedCost: boolean;
};
export type Customer = Entity & {
  name: string;
  phone: string;
  address: string;
};
export type Device = Entity & {
  userId: string;
  name: string;
  series: string;
  revoked: boolean;
  lastSeen: string;
  lastSyncedAt?: string;
  lastSyncedRevision?: number;
  pendingCount: number;
  counterId: string;
};
export type Member = Entity & {
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  canCollect: boolean;
};
export type OrderLine = {
  batchId: string;
  quantity: string;
  unit: string;
  confirmed: boolean;
};
export type Order = Entity & {
  lines: OrderLine[];
  customerId?: string;
  dispenserId: string;
  collectorId: string;
  counterId: string;
  version: number;
  status: "held" | "handoff" | "completed" | "cancelled";
  offeredTo?: string;
  cancelReason?: string;
  cancelledAt?: string;
  createdAt: string;
  prescription?: {
    patient: string;
    address: string;
    prescriber: string;
    prescriberAddress: string;
    reference: string;
  };
};
export type InvoiceLine = OrderLine & {
  productId: string;
  name: string;
  strength: string;
  form: string;
  hsn: string;
  batchCode: string;
  expiry: string;
  baseQuantity: string;
  pricePaise: number;
  taxBps: number;
  grossPaise: number;
  discountPaise: number;
  netPaise: number;
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  costPaise?: number;
};
export type Invoice = Entity & {
  number: string;
  orderId: string;
  deviceId: string;
  customerId?: string;
  dispenserId: string;
  collectorId: string;
  counterId: string;
  occurredAt: string;
  postedAt: string;
  lines: InvoiceLine[];
  grossPaise: number;
  discountPaise: number;
  totalPaise: number;
  taxPaise: number;
  offline: boolean;
  prescription?: Order["prescription"];
  business: Settings;
};
export type Payment = Entity & {
  invoiceId?: string;
  customerId?: string;
  kind: "sale" | "repayment" | "refund";
  method: "cash" | "upi";
  amountPaise: number;
  reference?: string;
  verification: "cash_counted" | "merchant_manually_verified";
  collectorId: string;
  occurredAt: string;
  drawerId?: string;
};
export type StockMovement = Entity & {
  batchId: string;
  quantity: string;
  quarantineDelta: string;
  kind:
    | "opening"
    | "purchase"
    | "sale"
    | "return"
    | "release"
    | "supplier_return"
    | "damage"
    | "expiry"
    | "correction";
  referenceId: string;
  actorId: string;
  occurredAt: string;
  reason: string;
};
export type LedgerEntry = Entity & {
  customerId: string;
  invoiceId?: string;
  amountPaise: number;
  kind: "credit_sale" | "repayment" | "credit_return";
  occurredAt: string;
};
export type Approval = Entity & {
  kind: "credit" | "discount" | "refund" | "stock";
  payload: Record<string, unknown>;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "used";
  decidedBy?: string;
  decidedAt?: string;
  reason: string;
};
export type DrawerSession = Entity & {
  openedAt: string;
  openedBy: string;
  openingPaise: number;
  closedAt?: string;
  countedPaise?: number;
  expectedAtClose?: number;
  discrepancyPaise?: number;
};
export type CashMovement = Entity & {
  drawerId: string;
  kind: "introduced" | "withdrawal" | "safe_transfer";
  amountPaise: number;
  reason: string;
  actorId: string;
  occurredAt: string;
};
export type Supplier = Entity & { name: string; gstin: string; phone: string };
export type Purchase = Entity & {
  supplierId: string;
  invoiceNumber: string;
  invoiceDate: string;
  documentId?: string;
  adjustmentPaise?: number;
  adjustmentReason?: string;
  totalPaise: number;
  lines: {
    batch: Batch;
    quantity: string;
    bonusQuantity: string;
    lineTotalPaise: number;
    source?: import("./receiving").InvoiceDraft["lines"][number];
    receiving?: {
      quantity: string;
      bonusQuantity: string;
      unit: string;
      baseUnitsPerUnit: string;
      priceUnit: string;
      baseUnitsPerPriceUnit: string;
    };
  }[];
  postedBy: string;
  postedAt: string;
};
export type Review = Entity & {
  kind:
    | "offline_stock"
    | "offline_price"
    | "payment"
    | "quarantined_command"
    | "camera"
    | "coverage"
    | "late_transaction";
  title: string;
  detail: string;
  referenceId: string;
  createdAt: string;
  status: "open" | "resolved";
  resolvedBy?: string;
  resolution?: string;
};
export type Observation = Entity & {
  counterId: string;
  trackId: string;
  startedAt: string;
  endedAt: string;
  candidateInvoiceIds: string[];
  association: "unmatched" | "candidate" | "ambiguous";
  clipId?: string;
  visible: boolean;
};
export type AuditEvent = Entity & {
  actorId: string;
  action: string;
  occurredAt: string;
  referenceId: string;
  detail: string;
};
export type Settings = {
  name: string;
  address: string;
  gstin: string;
  drugLicence: string;
  stateCode: string;
  phone: string;
  upiId: string;
  currency: "INR";
  timezone: "Asia/Kolkata";
  gatewayUrl: string;
  readinessConfirmed: boolean;
};
export type Eod = Entity & {
  date: string;
  revision: number;
  createdAt: string;
  totals: ReturnTypeTotals;
  provisional: boolean;
  syncCutoffAt?: string;
  syncCutoffRevision?: number;
};
export type ReturnTypeTotals = {
  netSalesPaise: number;
  cashCollectedPaise: number;
  upiCollectedPaise: number;
  creditOutstandingPaise: number;
  refundsPaise: number;
  discountsPaise: number;
  estimatedGrossMarginPaise: number | null;
  invoiceCount: number;
  pendingDevices: number;
};
export type Refund = Entity & {
  invoiceId: string;
  approvalId: string;
  lines: { index: number; quantity: string }[];
  totalPaise: number;
  creditReductionPaise: number;
  cashRefundPaise: number;
  upiRefundPaise: number;
  executedBy: string;
  occurredAt: string;
};
export type CommandReceipt = Entity & {
  fingerprint: string;
  result: unknown;
  actorId: string;
  revision: number;
};
export type QuarantinedCommand = Entity & {
  actorId: string;
  command: unknown;
  reason: string;
  status: "pending" | "accepted" | "rejected";
};
export type State = {
  businessId: string;
  revision: number;
  settings: Settings;
  members: Record<string, Member>;
  devices: Record<string, Device>;
  products: Record<string, Product>;
  batches: Record<string, Batch>;
  customers: Record<string, Customer>;
  suppliers: Record<string, Supplier>;
  purchases: Record<string, Purchase>;
  orders: Record<string, Order>;
  invoices: Record<string, Invoice>;
  payments: Record<string, Payment>;
  stock: Record<string, StockMovement>;
  ledger: Record<string, LedgerEntry>;
  approvals: Record<string, Approval>;
  drawers: Record<string, DrawerSession>;
  cash: Record<string, CashMovement>;
  reviews: Record<string, Review>;
  observations: Record<string, Observation>;
  audit: Record<string, AuditEvent>;
  eods: Record<string, Eod>;
  refunds: Record<string, Refund>;
  commands: Record<string, CommandReceipt>;
  quarantine: Record<string, QuarantinedCommand>;
};
export type Actor = {
  id: string;
  role: Role;
  businessId: string;
  canCollect: boolean;
  offlineAuthorized?: boolean;
  recovery?: boolean;
};
export const collections = [
  "members",
  "devices",
  "products",
  "batches",
  "customers",
  "suppliers",
  "purchases",
  "orders",
  "invoices",
  "payments",
  "stock",
  "ledger",
  "approvals",
  "drawers",
  "cash",
  "reviews",
  "observations",
  "audit",
  "eods",
  "refunds",
  "commands",
  "quarantine",
] as const;
export type Collection = (typeof collections)[number];
export function emptyState(
  businessId: string,
  settings: Partial<Settings> = {},
): State {
  return {
    businessId,
    revision: 0,
    settings: {
      name: "",
      address: "",
      gstin: "",
      drugLicence: "",
      stateCode: "",
      phone: "",
      upiId: "",
      currency: "INR",
      timezone: "Asia/Kolkata",
      gatewayUrl: "",
      readinessConfirmed: false,
      ...settings,
    },
    ...Object.fromEntries(collections.map((k) => [k, {}])),
  } as State;
}
