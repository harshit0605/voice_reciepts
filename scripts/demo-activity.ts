// Gives the demo shop "harshit-test" a lived-in look: a full day of trading yesterday, tidy
// names and a day report, so the screens look like a real shop when shown to its owner.
//
// It goes through the engine (execute), never around it, with `now` set to each command's own
// time so the history sits in the past. Everything runs in ONE database transaction: either all
// of it lands or none of it does. It refuses to touch any business but "harshit-test", and any
// shop whose name lacks "(test)".
//
//   tsx scripts/demo-activity.ts --dry-run   do everything, print the summary, roll it back
//   tsx scripts/demo-activity.ts             do it for real
//
// Run it inside the server's api container (DATABASE_URL is in its environment). /app/scripts
// may be read-only there; a copy named demo-activity.mts in a writable folder with a
// node_modules link to /app/node_modules works.
//
// It does nothing if yesterday is already seeded and refuses if yesterday already has bills or a
// drawer. Command ids start with demo-seed-<date>-. Today is left alone: no drawer is opened and
// no approval is left waiting, so the live demo starts with an opening count.
import { pool, readState, transact } from "@counterwell/db";
import {
  balance,
  execute,
  expectedCash,
  indiaDate,
  quote,
  type Actor,
  type State,
} from "@counterwell/core";

const TEST_ID = "harshit-test";
const idArg = process.argv.indexOf("--id");
const id = idArg > 0 ? process.argv[idArg + 1] : TEST_ID;
const dryRun = process.argv.includes("--dry-run");
if (id !== TEST_ID) {
  console.error(`Refusing: this script only runs for "${TEST_ID}".`);
  process.exit(1);
}
const before = await readState(id);
if (!before) {
  console.error(`Business ${id} not found.`);
  process.exit(1);
}
if (!before.settings.name.includes("(test)")) {
  console.error("Refusing: the shop name does not contain (test).");
  process.exit(1);
}

const nowIso = new Date().toISOString();
const Y = indiaDate(new Date(Date.parse(nowIso) - 86_400_000).toISOString());
const P = `demo-seed-${Y}`;
const at = (hms: string) => new Date(`${Y}T${hms}+05:30`).toISOString();
const before_ = (hms: string, seconds: number) =>
  new Date(Date.parse(at(hms)) - seconds * 1000).toISOString();

if (Object.keys(before.commands).some((c) => c.startsWith(P))) {
  console.log(`Already seeded for ${Y}; nothing to do.`);
  await pool.end();
  process.exit(0);
}
if (
  Object.values(before.invoices).some((i) => indiaDate(i.occurredAt) === Y) ||
  Object.values(before.drawers).some((d) => indiaDate(d.openedAt) === Y)
) {
  console.error(`${Y} already has bills or a drawer; refusing to mix.`);
  process.exit(1);
}

const members = Object.values(before.members);
const owner = members.find(
  (m) => m.role === "owner" && m.username === "harshit",
);
const staff = members.find(
  (m) => m.role === "employee" && m.username === "teststaff",
);
if (!owner || !staff) {
  console.error("Owner harshit or staff teststaff not found.");
  process.exit(1);
}
const actors: Record<"owner" | "staff", Actor> = {
  owner: {
    id: owner.id,
    role: "owner",
    businessId: id,
    canCollect: owner.canCollect,
  },
  staff: {
    id: staff.id,
    role: "employee",
    businessId: id,
    canCollect: staff.canCollect,
  },
};
const phone = Object.values(before.devices)
  .filter((d) => d.userId === staff.id && !d.revoked)
  .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
if (!phone) {
  console.error("Staff has no active phone to bill from.");
  process.exit(1);
}

/** A note-and-coin count that adds up to the amount; coins are a paise amount. */
const notes = (paise: number) => {
  const d: Record<string, number> = {};
  let rest = paise;
  for (const note of [500, 200, 100, 50, 20, 10]) {
    const count = Math.floor(rest / (note * 100));
    if (count) d[String(note)] = count;
    rest -= count * note * 100;
  }
  if (rest) d.coins = rest;
  return d;
};

class DryRun extends Error {
  constructor(public summary: unknown) {
    super("dry run");
  }
}

// ---- yesterday's bills ---------------------------------------------------------------
const ALL = -1; // "whatever is left of the bill"
type Line = [batch: string, quantity: string, unit: string];
type Rx = {
  patient: string;
  address: string;
  prescriber: string;
  prescriberAddress: string;
  reference: string;
};
type Bill = {
  t: string; // India time of the checkout
  lines: Line[];
  who?: string;
  rx?: Rx;
  cash?: number;
  upi?: number;
  credit?: number;
  discount?: number;
  approval?: string; // owner approval reason for the credit or discount
  newCustomer?: { id: string; name: string; phone: string; address: string };
};
const DOLO = "dolo-b1",
  AZI = "azithral-b1",
  ORS = "ors-b1",
  CET = "cetirizine-b1",
  BET = "betadine-b1",
  BAN = "bandage-b1";
const rx = (
  patient: string,
  address: string,
  prescriber: string,
  prescriberAddress: string,
  reference: string,
): Rx => ({ patient, address, prescriber, prescriberAddress, reference });
const bills: Bill[] = [
  {
    t: "09:34:20",
    lines: [
      [DOLO, "1", "strip"],
      [ORS, "2", "sachet"],
    ],
    cash: ALL,
  },
  { t: "09:52:05", lines: [[CET, "2", "strip"]], cash: ALL },
  {
    t: "10:20:41",
    lines: [
      [BAN, "2", "piece"],
      [BET, "1", "bottle"],
    ],
    upi: ALL,
  },
  {
    t: "11:05:12",
    lines: [[AZI, "1", "strip"]],
    who: "Meera Sharma",
    rx: rx(
      "Meera Sharma",
      "Aliganj, Lucknow",
      "Dr. R. K. Mishra",
      "Civil Hospital, Lucknow",
      "OPD-26-4471",
    ),
    cash: ALL,
  },
  {
    t: "11:40:36",
    lines: [
      [ORS, "4", "sachet"],
      [CET, "1", "strip"],
    ],
    cash: ALL,
  },
  {
    t: "12:25:09",
    lines: [
      [BET, "2", "bottle"],
      [BAN, "3", "piece"],
    ],
    cash: 20_000,
    upi: ALL,
  },
  {
    t: "13:10:50",
    lines: [
      [DOLO, "1", "strip"],
      [DOLO, "5", "tablet"],
    ],
    cash: ALL,
  },
  {
    t: "14:15:27",
    lines: [
      [BET, "1", "bottle"],
      [ORS, "6", "sachet"],
      [BAN, "2", "piece"],
    ],
    who: "Sunita Devi",
    credit: ALL,
    approval: "Regular customer, will pay at the start of the month",
  },
  {
    t: "14:55:08",
    lines: [
      [AZI, "2", "strip"],
      [CET, "2", "strip"],
    ],
    who: "Mohd. Arif",
    rx: rx(
      "Mohd. Arif",
      "Chowk, Lucknow",
      "Dr. S. Khan",
      "Khan Hospital, Lucknow",
      "KH-26-2210",
    ),
    credit: 20_000,
    cash: ALL,
    approval: "Known customer, will settle at the weekend",
  },
  {
    t: "15:30:44",
    lines: [
      [CET, "1", "strip"],
      [ORS, "2", "sachet"],
    ],
    upi: ALL,
  },
  {
    t: "16:45:18",
    lines: [
      [BET, "1", "bottle"],
      [BAN, "2", "piece"],
      [ORS, "2", "sachet"],
    ],
    newCustomer: {
      id: `${P}-customer-geeta`,
      name: "Geeta Verma",
      phone: "8423705169",
      address: "Rajajipuram, Lucknow",
    },
    who: "Geeta Verma",
    discount: 1000,
    approval: "Regular customer, rounding the bill off by Rs 10",
    cash: ALL,
  },
  {
    t: "18:05:52",
    lines: [
      [CET, "2", "strip"],
      [ORS, "2", "sachet"],
      [BAN, "1", "piece"],
    ],
    upi: ALL,
  },
  {
    t: "19:20:15",
    lines: [
      [AZI, "1", "strip"],
      [ORS, "2", "sachet"],
    ],
    newCustomer: {
      id: `${P}-customer-suresh`,
      name: "Suresh Gupta",
      phone: "9452316078",
      address: "Indira Nagar, Lucknow",
    },
    who: "Suresh Gupta",
    rx: rx(
      "Suresh Gupta",
      "Indira Nagar, Lucknow",
      "Dr. A. Siddiqui",
      "Siddiqui Clinic, Lucknow",
      "CL-26-0893",
    ),
    cash: 2300,
    upi: ALL,
  },
  {
    t: "20:10:33",
    lines: [
      [ORS, "2", "sachet"],
      [BAN, "1", "piece"],
    ],
    cash: ALL,
  },
];

// ---- the transaction -------------------------------------------------------------------
const summarise = (st: State, closedOld: unknown) => {
  const money = (paise: number) => paise / 100;
  const day = (at_: string) => indiaDate(at_) === Y;
  const invoices = Object.values(st.invoices).filter((i) => day(i.occurredAt));
  const payments = Object.values(st.payments).filter(
    (p) => day(p.occurredAt) && p.kind === "sale",
  );
  const by = (method: string) =>
    money(
      payments
        .filter((p) => p.method === method)
        .reduce((n, p) => n + p.amountPaise, 0),
    );
  const credit = Object.values(st.ledger)
    .filter((l) => day(l.occurredAt) && l.kind === "credit_sale")
    .reduce((n, l) => n + l.amountPaise, 0);
  const drawer = Object.values(st.drawers).find((d) => day(d.openedAt));
  return {
    date: Y,
    bills: invoices.length,
    billedRs: money(invoices.reduce((n, i) => n + i.totalPaise, 0)),
    discountRs: money(invoices.reduce((n, i) => n + i.discountPaise, 0)),
    cashRs: by("cash"),
    upiRs: by("upi"),
    creditRs: money(credit),
    creditBalancesRs: Object.fromEntries(
      Object.values(st.customers)
        .filter((c) => balance(st, c.id) !== 0)
        .map((c) => [c.name, money(balance(st, c.id))]),
    ),
    drawer: drawer && {
      openingRs: money(drawer.openingPaise),
      openingDifferenceRs: money(drawer.openingDifferencePaise ?? 0),
      checks: (drawer.checks ?? []).map((c) => [
        money(c.countedPaise),
        money(c.differencePaise),
      ]),
      expectedAtCloseRs: money(drawer.expectedAtClose ?? 0),
      countedRs: money(drawer.countedPaise ?? 0),
      differenceRs: money(drawer.discrepancyPaise ?? 0),
      keptRs: money(drawer.keptPaise ?? 0),
    },
    eods: Object.values(st.eods).map((e) => ({
      id: e.id,
      provisional: e.provisional,
      bills: e.report?.sales.bills,
    })),
    pendingApprovals: Object.values(st.approvals).filter(
      (a) => a.status === "pending",
    ).length,
    openDrawers: Object.values(st.drawers).filter((d) => !d.closedAt).length,
    revokedDevices: Object.values(st.devices)
      .filter((d) => d.revoked)
      .map((d) => d.name),
    shop: st.settings.name,
    members: Object.values(st.members).map((m) => `${m.username}: ${m.name}`),
    customers: Object.values(st.customers).map((c) => `${c.name} ${c.phone}`),
    closedOldDrawer: closedOld,
    batches: Object.values(st.batches)
      .filter((b) => b.code.startsWith("SHORT-"))
      .map((b) => `${b.code} qty ${b.quantity} exp ${b.expiry}`),
    otherStock: Object.values(st.batches)
      .filter((b) => !b.code.startsWith("SHORT-"))
      .map((b) => `${b.productId} ${b.quantity}`),
  };
};

const apply = () =>
  transact(id, (original) => {
    let st: State = structuredClone(original);
    const stamp = new Date().toISOString();
    const go = (
      cid: string,
      occurredAt: string,
      who: "owner" | "staff",
      operation: Record<string, unknown>,
    ) => {
      st = execute(
        st,
        { id: cid, occurredAt, operation },
        actors[who],
        occurredAt,
      ).state;
    };
    const customer = (name: string) => {
      const c = Object.values(st.customers).find((x) => x.name === name);
      if (!c) throw new Error(`Customer ${name} missing`);
      return c.id;
    };
    const total = (
      lines: ReturnType<typeof toLines>,
      t: string,
      discount = 0,
    ) => quote(st, lines, at(t), discount).reduce((n, l) => n + l.netPaise, 0);
    const toLines = (b: Bill) =>
      b.lines.map(([batchId, quantity, unit]) => ({
        batchId,
        quantity,
        unit,
        confirmed: true,
      }));

    // A day report treats a phone seen near its day as one it must wait for. This phone was
    // last seen after the demo day, so park every phone's last-seen date while the old reports
    // are made, and put the real values back at the end.
    const seen = Object.fromEntries(
      Object.values(st.devices).map((d) => [d.id, d.lastSeen]),
    );
    for (const d of Object.values(st.devices))
      d.lastSeen = "2026-01-01T00:00:00.000Z";

    // 1. Names. There is no command for these, so the stored records are edited directly.
    for (const [old, name, number] of [
      ["Test customer", "Ramesh Yadav", "9415638210"],
      ["Apk check customer", "Sunita Devi", "7081345926"],
      ["Keyboard check", "Mohd. Arif", "9936082741"],
    ]) {
      const c = Object.values(st.customers).find((x) => x.name === old);
      if (c) {
        c.name = name;
        c.phone = number;
      }
    }
    for (const c of Object.values(st.customers))
      if (c.name === "Meera Sharma" && !c.phone) c.phone = "9839204517";
    st.members[owner.id].name = "Anil Sharma";
    st.members[staff.id].name = "Ravi Kumar";
    const s = st.settings;
    go(`${P}-settings`, stamp, "owner", {
      type: "settings.update",
      settings: {
        name: "Sharma Medical Store (test)",
        address: s.address,
        gstin: s.gstin,
        drugLicence: s.drugLicence,
        stateCode: s.stateCode,
        phone: s.phone,
        upiId: s.upiId,
        gatewayUrl: s.gatewayUrl,
        readinessConfirmed: s.readinessConfirmed,
      },
    });

    // 2. The seeded preview device.
    const preview = Object.values(st.devices).find(
      (d) => d.name === "Preview device" && !d.revoked,
    );
    if (preview)
      go(`${P}-revoke-preview`, stamp, "owner", {
        type: "device.revoke",
        deviceId: preview.id,
      });

    // The first demo left a drawer open from days ago. Finish that old day (cancel the bill
    // nobody completed, count the drawer exactly) so a new day can open.
    let closedOld: unknown;
    const stale = Object.values(st.drawers).find((d) => !d.closedAt);
    if (stale) {
      if (stale.id !== "drawer-demo")
        throw new Error(`Unexpected open drawer ${stale.id}`);
      const last = Date.parse(
        [
          stale.openedAt,
          ...Object.values(st.invoices).map((i) => i.occurredAt),
          ...Object.values(st.payments).map((p) => p.occurredAt),
        ]
          .sort()
          .at(-1)!,
      );
      const later = (minutes: number) =>
        new Date(last + minutes * 60_000).toISOString();
      for (const o of Object.values(st.orders).filter(
        (x) => x.status === "held" && x.collectorId === staff.id,
      ))
        go(`${P}-old-cancel-${o.id}`, later(20), "staff", {
          type: "order.cancel",
          orderId: o.id,
          version: o.version,
          reason: "Customer left without buying",
        });
      const counted = expectedCash(st, stale.id);
      go(`${P}-old-close`, later(90), "owner", {
        type: "drawer.close",
        drawerId: stale.id,
        countedPaise: counted,
        keptPaise: 200_000,
        denominations: notes(counted),
      });
      closedOld = {
        drawer: stale.id,
        closedAt: later(90),
        countedRs: counted / 100,
      };
    }

    // 3. Yesterday: a drawer, bills, a few cash events, and the close. Steps run in time order.
    const drawerId = `${P}-drawer`;
    let sequence =
      Math.max(
        0,
        ...Object.values(st.invoices)
          .filter((i) => i.deviceId === phone.id)
          .map((i) => Number(i.number.split("-").pop())),
      ) + 1;
    let upiCount = 0;
    const upiRef = () =>
      String(
        412_000_000_000 +
          ((++upiCount * 2_654_435_761 + 77_123_456_789) % 587_000_000_000),
      );

    const bill = (b: Bill, n: number) => {
      const key = `${P}-bill-${String(n).padStart(2, "0")}`;
      if (b.newCustomer)
        go(`${key}-customer`, before_(b.t, 400), "staff", {
          type: "customer.create",
          customer: b.newCustomer,
        });
      const customerId = b.who ? customer(b.who) : undefined;
      const orderId = `${key}-order`;
      const lines = toLines(b);
      go(`${key}-save`, before_(b.t, b.approval ? 330 : 150), "staff", {
        type: "order.save",
        orderId,
        version: 0,
        lines,
        counterId: phone.counterId,
        ...(customerId ? { customerId } : {}),
        ...(b.rx ? { prescription: b.rx } : {}),
      });
      const gross = total(lines, b.t);
      const net = total(lines, b.t, b.discount ?? 0);
      const credit = b.credit === ALL ? net : (b.credit ?? 0);
      const approvalId = `${key}-approval`;
      if (b.approval) {
        go(`${key}-ask`, before_(b.t, 250), "staff", {
          type: "approval.request",
          approvalId,
          kind: credit ? "credit" : "discount",
          payload: credit
            ? {
                orderId,
                orderVersion: 1,
                customerId: customerId!,
                amountPaise: credit,
              }
            : { orderId, orderVersion: 1, amountPaise: b.discount! },
          reason: b.approval,
        });
        go(`${key}-decide`, before_(b.t, 170), "owner", {
          type: "approval.decide",
          approvalId,
          approve: true,
        });
      }
      const fixed = (v?: number) => (v === undefined || v === ALL ? 0 : v);
      let cash = fixed(b.cash),
        upi = fixed(b.upi);
      const rest = net - credit - cash - upi;
      if (b.cash === ALL) cash = rest;
      else if (b.upi === ALL) upi = rest;
      else if (rest !== 0)
        throw new Error(`${key}: payments do not add up (${gross}, ${net})`);
      go(key, at(b.t), "staff", {
        type: "checkout",
        orderId,
        version: 1,
        deviceId: phone.id,
        sequence: sequence++,
        cashPaise: cash,
        upiPaise: upi,
        creditPaise: credit,
        discountPaise: b.discount ?? 0,
        ...(upi ? { upiReference: upiRef(), upiVerified: true } : {}),
        ...(credit ? { creditApprovalId: approvalId } : {}),
        ...(b.discount ? { discountApprovalId: approvalId } : {}),
      });
    };

    type Step = { t: string; run: () => void };
    let billNumber = 0;
    const steps: Step[] = [
      {
        t: "09:15:12",
        run: () =>
          go(`${P}-open`, at("09:15:12"), "staff", {
            type: "drawer.open",
            drawerId,
            openingPaise: 200_000,
            denominations: {
              "500": 2,
              "200": 2,
              "100": 3,
              "50": 2,
              "20": 5,
              "10": 10,
            },
          }),
      },
      ...bills.map((b): Step => ({ t: b.t, run: () => bill(b, ++billNumber) })),
      {
        t: "12:50:40",
        run: () =>
          go(`${P}-delivery`, at("12:50:40"), "staff", {
            type: "cash.move",
            drawerId,
            kind: "withdrawal",
            amountPaise: 6000,
            reason: "Delivery boy charge",
          }),
      },
      {
        t: "13:30:05",
        run: () => {
          const counted = expectedCash(st, drawerId);
          go(`${P}-midday-count`, at("13:30:05"), "staff", {
            type: "drawer.count",
            drawerId,
            countedPaise: counted,
            denominations: notes(counted),
            note: "Mid-day check",
          });
        },
      },
      {
        t: "17:05:30",
        run: () =>
          go(`${P}-repay`, at("17:05:30"), "staff", {
            type: "credit.repay",
            customerId: customer("Ramesh Yadav"),
            amountPaise: 10_000,
            method: "cash",
          }),
      },
      {
        t: "21:00:48",
        run: () => {
          // Rs 20 short, and Rs 2,000 stays in the drawer for tomorrow's opening.
          const counted = expectedCash(st, drawerId) - 2000;
          go(`${P}-close`, at("21:00:48"), "staff", {
            type: "drawer.close",
            drawerId,
            countedPaise: counted,
            keptPaise: 200_000,
            denominations: notes(counted),
          });
        },
      },
    ].sort((a, b) => a.t.localeCompare(b.t));
    for (const step of steps) step.run();

    for (const d of Object.values(st.devices)) d.lastSeen = seen[d.id];
    const summary = summarise(st, closedOld);
    if (dryRun) throw new DryRun(summary);
    return { state: st, result: summary };
  });

try {
  console.log(JSON.stringify(await apply(), null, 1));
} catch (e) {
  if (e instanceof DryRun) {
    console.log("DRY RUN (rolled back)");
    console.log(JSON.stringify(e.summary, null, 1));
  } else {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}
await pool.end();
