import { emptyState, type State } from "./types";
export function demoState(
  businessId = "pilot-pharmacy",
  ownerId = "demo-owner",
  employeeId = "demo-employee",
  now = new Date().toISOString(),
): State {
  const s = emptyState(businessId, {
    name: "District Pharmacy · Demo",
    address: "Hospital Road, Lucknow, Uttar Pradesh",
    gstin: "09DEMOA0000A1Z5",
    drugLicence: "DEMO — NOT A REAL LICENCE",
    stateCode: "09",
    phone: "",
    upiId: "",
    readinessConfirmed: true,
  });
  s.members[ownerId] = {
    id: ownerId,
    name: "Shop owner",
    role: "owner",
    active: true,
    mustChangePassword: false,
    canCollect: true,
  };
  s.members[employeeId] = {
    id: employeeId,
    name: "Aarav",
    role: "employee",
    active: true,
    mustChangePassword: false,
    canCollect: true,
  };
  const products = [
    [
      "dolo",
      "Dolo",
      "Paracetamol",
      "650 mg",
      "tablet",
      "32",
      "280",
      "225",
      "12",
    ],
    [
      "azithral",
      "Azithral",
      "Azithromycin",
      "500 mg",
      "tablet",
      "24",
      "2600",
      "2080",
      "5",
    ],
    [
      "ors",
      "ORS",
      "Oral rehydration salts",
      "21 g",
      "sachet",
      "58",
      "2250",
      "1800",
      "12",
    ],
    [
      "cetirizine",
      "Cetirizine",
      "Cetirizine",
      "10 mg",
      "tablet",
      "140",
      "350",
      "260",
      "12",
    ],
    [
      "betadine",
      "Betadine",
      "Povidone iodine",
      "10% · 100 ml",
      "bottle",
      "16",
      "14500",
      "11000",
      "5",
    ],
    [
      "bandage",
      "Cotton bandage",
      "Cotton bandage",
      "10 cm × 4 m",
      "piece",
      "45",
      "3500",
      "2500",
      "5",
    ],
  ];
  for (const [
    id,
    name,
    generic,
    strength,
    baseUnit,
    quantity,
    price,
    cost,
    tax,
  ] of products) {
    s.products[id] = {
      id,
      name,
      generic,
      strength,
      form: baseUnit,
      hsn: "3004",
      aliases: [generic.toLowerCase(), name.toLowerCase()],
      barcode: `DEMO-${id}`,
      units:
        baseUnit === "tablet"
          ? { tablet: "1", strip: id === "azithral" ? "3" : "10" }
          : { [baseUnit]: "1" },
      baseUnit,
      taxBps: Number(tax) * 100,
      reorderAt: "20",
      schedule: id === "azithral" ? "H" : "OTC",
      active: true,
    };
    const batchId = `${id}-b1`;
    const expiry = new Date(Date.parse(now) + 200 * 86400000)
      .toISOString()
      .slice(0, 10);
    s.batches[batchId] = {
      id: batchId,
      productId: id,
      code: `${id.slice(0, 3).toUpperCase()}2401`,
      expiry,
      quantity,
      quarantined: "0",
      pricePaise: Number(price),
      mrpPaise: Number(price),
      costPaise: Number(cost),
      verifiedCost: true,
    };
    s.stock[`opening-${id}`] = {
      id: `opening-${id}`,
      batchId,
      quantity,
      quarantineDelta: "0",
      kind: "opening",
      referenceId: batchId,
      actorId: ownerId,
      occurredAt: now,
      reason: "Synthetic demonstration stock",
    };
  }
  s.customers["customer-1"] = {
    id: "customer-1",
    name: "Meera Sharma",
    phone: "",
    address: "",
  };
  s.suppliers["supplier-1"] = {
    id: "supplier-1",
    name: "Demo Pharma Distributors",
    gstin: "",
    phone: "",
  };
  s.drawers["drawer-demo"] = {
    id: "drawer-demo",
    openedAt: new Date(Date.parse(now) - 3600000).toISOString(),
    openedBy: ownerId,
    openingPaise: 200000,
  };
  s.devices["demo-device"] = {
    id: "demo-device",
    userId: ownerId,
    name: "Preview device",
    series: "D01",
    revoked: false,
    lastSeen: now,
    pendingCount: 0,
    counterId: "counter-1",
  };
  return s;
}
