import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { authClient, API_URL, cookieHeaders } from "./auth";
import * as storage from "./storage";
import {
  demoState,
  execute,
  employeeView,
  fiscalYear,
  invoiceNumber,
  type Actor,
  type State,
  type Command,
  type Operation,
  type Invoice,
  type OrderLine,
  type CheckoutAttempt,
} from "@counterwell/core";
const NO_RESPONSE =
  "No response from the server. This may already be saved, so do not collect payment again. It will be checked when the connection returns.";
type Identity = {
  actor: Actor;
  deviceId: string;
  lease: string;
  issuedAt: string;
  expiresAt: string;
};
type Ctx = {
  state: State | null;
  identity: Identity | null;
  demo: boolean;
  loading: boolean;
  online: boolean;
  error: string;
  language: "en" | "hi";
  pending: storage.Queued[];
  /** Online command sent without a definite answer; retried with the same ID until resolved. */
  uncertain: Command | null;
  login: (u: string, p: string) => Promise<void>;
  changePassword: (current: string, password: string) => Promise<void>;
  passwordRequired: boolean;
  startDemo: (role?: "owner" | "employee") => void;
  logout: () => Promise<void>;
  setLanguage: (v: "en" | "hi") => void;
  command: (op: Operation) => Promise<any>;
  cashSale: (
    lines: OrderLine[],
    customerId: string | undefined,
    prescription: State["orders"][string]["prescription"],
    attempt: CheckoutAttempt,
  ) => Promise<Invoice>;
  sync: () => Promise<void>;
  refresh: () => Promise<void>;
  request: (route: string, init?: RequestInit) => Promise<any>;
  setError: (s: string) => void;
  reserveSequence: () => Promise<number>;
  assignCounter: (counterId: string) => Promise<void>;
};
const context = createContext<Ctx>(null!);
export const uid = () => Crypto.randomUUID();
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State | null>(null),
    [identity, setIdentity] = useState<Identity | null>(null),
    [demo, setDemo] = useState(false),
    [loading, setLoading] = useState(true),
    [online, setOnline] = useState(true),
    [error, setError] = useState(""),
    [language, changeLanguage] = useState<"en" | "hi">("en"),
    [pending, setPending] = useState<storage.Queued[]>([]),
    [uncertain, setUncertain] = useState<Command | null>(null),
    [passwordRequired, setPasswordRequired] = useState(false);
  const demoRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const syncing = useRef(false);
  const operating = useRef(false);
  // Refreshes can overlap (the quick poll, a command, a full sync); never let an older answer win.
  const applied = useRef({ scope: "", revision: -1 });
  const scope = () =>
    `${identityRef.current!.actor.businessId}:${identityRef.current!.actor.id}`;
  // A rejected checkout never used its invoice number; give it back so the GST series has no gap.
  async function releaseRejected(cmd: Command, e: unknown) {
    const op = cmd.operation;
    if (op.type === "checkout" && (e as any).code !== "INVOICE_NUMBER_USED")
      await storage.releaseSequence(
        `${op.deviceId}:${fiscalYear(cmd.occurredAt)}`,
        op.sequence,
      );
  }
  async function markUncertain(cmd: Command | null) {
    if (cmd) await storage.set(`online:${scope()}`, cmd);
    else await storage.remove(`online:${scope()}`);
    setUncertain(cmd);
  }
  function setLanguage(value: "en" | "hi") {
    changeLanguage(value);
    void storage.set("language", value);
  }
  async function request(route: string, init: RequestInit = {}) {
    const a = identityRef.current?.actor;
    const headers: Record<string, string> = {
      ...(await cookieHeaders()),
      ...(a ? { "X-Business-Id": a.businessId } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (init.body && !(init.body instanceof FormData))
      headers["Content-Type"] = "application/json";
    let r: Response;
    try {
      r = await fetch(`${API_URL}/api/v1${route}`, {
        ...init,
        headers,
        credentials: "include",
        signal: AbortSignal.timeout(15000),
      });
      setOnline(true);
    } catch (e) {
      setOnline(false);
      throw new Error(
        "Connection unavailable. Cash billing can continue in the mobile app while your authorisation is valid.",
      );
    }
    const data = await r.json();
    if (!r.ok) {
      if (data.code === "PASSWORD_CHANGE_REQUIRED") setPasswordRequired(true);
      throw Object.assign(new Error(data.error ?? "Request failed"), {
        httpStatus: r.status,
        code: data.code,
      });
    }
    return data;
  }
  async function establish() {
    applied.current = { scope: "", revision: -1 };
    const me = await request("/me");
    const m = me.memberships.find((x: any) => x.active);
    if (!m) throw new Error("No active shop membership");
    const base: Identity = {
      actor: {
        id: me.userId,
        businessId: m.businessId,
        role: m.role,
        canCollect: m.canCollect,
      },
      deviceId: "",
      lease: "",
      issuedAt: "",
      expiresAt: "",
    };
    identityRef.current = base;
    setIdentity(base);
    setUncertain(await storage.get<Command>(`online:${scope()}`));
    if (m.mustChangePassword) {
      setPasswordRequired(true);
      return;
    }
    const key = `device:${m.businessId}:${me.userId}`;
    let deviceId = await storage.get<string>(key);
    if (!deviceId) {
      deviceId = uid();
      await storage.set(key, deviceId);
    }
    const registration = await request("/devices/register", {
      method: "POST",
      body: JSON.stringify({
        id: deviceId,
        name: `${Platform.OS} employee device`,
        counterId: "counter-1",
      }),
    });
    const next = {
      ...base,
      deviceId,
      lease: registration.lease,
      issuedAt: registration.issuedAt,
      expiresAt: registration.expiresAt,
    };
    identityRef.current = next;
    setIdentity(next);
    await storage.set("identity", next);
    await refresh();
    // Resolve unanswered actions and queued sales now rather than at the next 30-second tick.
    void sync();
  }
  async function login(username: string, password: string) {
    setError("");
    const r = await authClient.signIn.username({ username, password });
    if (r.error) throw new Error(r.error.message ?? "Sign in failed");
    demoRef.current = false;
    setDemo(false);
    await establish();
  }
  async function changePassword(currentPassword: string, newPassword: string) {
    // Through the auth client, so the replacement session cookie is stored: the
    // change signs out every session, including the one that made it.
    const r = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (r.error) throw new Error(r.error.message ?? "Password change failed");
    setPasswordRequired(false);
    await establish();
  }
  function startDemo(role: "owner" | "employee" = "owner") {
    demoRef.current = true;
    const s = demoState();
    const id = role === "owner" ? "demo-owner" : "demo-employee";
    s.devices["demo-device"].userId = id;
    const a = { id, role, businessId: s.businessId, canCollect: true };
    const i = {
      actor: a,
      deviceId: "demo-device",
      lease: "demo",
      issuedAt: new Date(Date.now() - 60000).toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    identityRef.current = i;
    setIdentity(i);
    setState(s);
    stateRef.current = s;
    setDemo(true);
    setPending([]);
    setUncertain(null);
    setError("");
    setPasswordRequired(false);
  }
  async function assignCounter(counterId: string) {
    if (!/^[\w-]{1,40}$/.test(counterId))
      throw new Error("Use a short counter ID such as counter-1");
    const i = identityRef.current!;
    if (demo) {
      const next = structuredClone(stateRef.current!);
      next.devices[i.deviceId].counterId = counterId;
      setState(next);
      stateRef.current = next;
      return;
    }
    if (pending.length)
      throw new Error("Synchronise queued sales before changing counter");
    const r = await request("/devices/register", {
      method: "POST",
      body: JSON.stringify({
        id: i.deviceId,
        name: `${Platform.OS} employee device`,
        counterId,
      }),
    });
    const next = {
      ...i,
      lease: r.lease,
      issuedAt: r.issuedAt,
      expiresAt: r.expiresAt,
    };
    setIdentity(next);
    identityRef.current = next;
    await storage.set("identity", next);
    await refresh();
  }
  async function logout() {
    if (
      pending.length ||
      (!demo && identityRef.current && (await storage.get(`online:${scope()}`)))
    )
      throw new Error(
        "Synchronise or recover pending actions before signing out.",
      );
    if (!demo) await authClient.signOut();
    await storage.remove("identity");
    setState(null);
    setUncertain(null);
    setIdentity(null);
    identityRef.current = null;
    setDemo(false);
  }
  async function refresh() {
    if (demoRef.current || !identityRef.current) return;
    const currentScope = scope();
    const remoteKey = `remote:${currentScope}`;
    let fresh = await storage.get<State>(remoteKey);
    if (fresh) {
      const delta = await request(`/sync?since=${fresh.revision}`);
      if (!delta.unchanged) {
        fresh = {
          ...fresh,
          revision: delta.revision,
          settings: delta.settings,
        };
        for (const [name, rows] of Object.entries(delta.changes) as [
          keyof State,
          Record<string, unknown>,
        ][])
          for (const [id, row] of Object.entries(rows)) {
            if (row === null) delete (fresh[name] as any)[id];
            else (fresh[name] as any)[id] = row;
          }
      }
    } else fresh = (await request("/state")) as State;
    if (demoRef.current || !identityRef.current || scope() !== currentScope)
      return;
    if (
      applied.current.scope === currentScope &&
      fresh.revision < applied.current.revision
    )
      return;
    applied.current = { scope: currentScope, revision: fresh.revision };
    await storage.set(remoteKey, fresh);
    const entries =
      (await storage.get<storage.Queued[]>(`outbox:${currentScope}`)) ?? [];
    let projected = fresh;
    for (const entry of entries) {
      if (!fresh.invoices[`${entry.command.id}:invoice`])
        try {
          projected = execute(
            projected,
            entry.command,
            { ...identityRef.current!.actor, offlineAuthorized: true },
            new Date().toISOString(),
          ).state;
        } catch {
          /* keep queued sale in the recovery list even when the cache cannot project it */
        }
    }
    if (demoRef.current || !identityRef.current || scope() !== currentScope)
      return;
    stateRef.current = projected;
    setState(projected);
    setPending(entries);
    await storage.set(`state:${currentScope}`, projected);
  }
  async function command(operation: Operation) {
    if (operating.current) throw new Error("Another action is being saved");
    operating.current = true;
    try {
      const cmd: Command = {
        id: uid(),
        occurredAt: new Date().toISOString(),
        operation,
      };
      if (demo) {
        const out = execute(stateRef.current!, cmd, identityRef.current!.actor);
        stateRef.current = out.state;
        setState(out.state);
        return out.result;
      }
      // Preserve uncertain online mutations for exact-id retry rather than issuing a second checkout.
      const unresolved = await storage.get<Command>(`online:${scope()}`);
      if (unresolved) {
        void sync();
        throw new Error(
          "An earlier action is still waiting for a server response. Try again after it is checked.",
        );
      }
      await markUncertain(cmd);
      let result: any;
      try {
        result = await request("/commands", {
          method: "POST",
          body: JSON.stringify(cmd),
        });
      } catch (e) {
        const status = (e as any).httpStatus;
        if (status && status < 500) {
          await markUncertain(null);
          await releaseRejected(cmd, e);
          throw e;
        }
        throw new Error(NO_RESPONSE);
      }
      await markUncertain(null);
      try {
        await refresh();
      } catch {
        setError(
          "Saved on the server. The view will update after reconnection; do not collect payment again.",
        );
      }
      return result.result;
    } finally {
      operating.current = false;
    }
  }
  async function reserveSequence() {
    const i = identityRef.current!,
      s = stateRef.current!;
    const key = `${i.deviceId}:${fiscalYear(new Date().toISOString())}`;
    const existing = Object.values(s.invoices)
      .filter(
        (x) =>
          x.deviceId === i.deviceId &&
          fiscalYear(x.occurredAt) === fiscalYear(new Date().toISOString()),
      )
      .map((x) => Number(x.number.split("-").at(-1)));
    const max = Math.max(0, ...existing);
    const local = (await storage.get<number>(`sequence:${key}`)) ?? 0;
    if (max > local) await storage.set(`sequence:${key}`, max);
    return storage.nextSequence(key);
  }
  async function cashSale(
    lines: OrderLine[],
    customerId: string | undefined,
    prescription: State["orders"][string]["prescription"],
    attempt: CheckoutAttempt,
  ): Promise<Invoice> {
    if (operating.current) throw new Error("A sale is being saved");
    operating.current = true;
    try {
      const i = identityRef.current!,
        s = stateRef.current!;
      const id = attempt.cashCommandId,
        orderId = attempt.orderId;
      const recorded = s.invoices[`${id}:invoice`];
      if (recorded) return recorded;
      const now = new Date().toISOString();
      if (now < i.issuedAt || now > i.expiresAt)
        throw new Error(
          "Reconnect to renew your 24-hour offline authorisation",
        );
      if (!demo && !storage.durableOffline)
        throw new Error(
          "Cash billing requires the encrypted Android or iOS app. The browser is a review and demo preview.",
        );
      const { quote } = await import("@counterwell/core");
      const total = quote(s, lines, now).reduce((n, l) => n + l.netPaise, 0);
      const key = `${i.deviceId}:${fiscalYear(now)}`;
      const max = Math.max(
        0,
        ...Object.values(s.invoices)
          .filter(
            (x) =>
              x.deviceId === i.deviceId &&
              fiscalYear(x.occurredAt) === fiscalYear(now),
          )
          .map((x) => Number(x.number.split("-").at(-1))),
      );
      if (((await storage.get<number>(`sequence:${key}`)) ?? 0) < max)
        await storage.set(`sequence:${key}`, max);
      const saved = await storage.commitCash(scope(), key, id, (sequence) => {
        const cmd: Command = {
          id,
          occurredAt: now,
          operation: {
            type: "offline.checkout",
            deviceId: i.deviceId,
            sequence,
            orderId,
            counterId: s.devices[i.deviceId]?.counterId ?? "counter-1",
            lines: lines.map((l) => ({
              ...l,
              pricePaise: s.batches[l.batchId].pricePaise,
              taxBps: s.products[s.batches[l.batchId].productId].taxBps,
            })),
            customerId,
            cashPaise: total,
            dispenserId: i.actor.id,
            prescription,
          },
        };
        const out = execute(s, cmd, { ...i.actor, offlineAuthorized: true });
        return {
          entry: { command: cmd, lease: i.lease, status: "local" },
          state: out.state,
        };
      });
      if (!saved)
        throw new Error(
          "This cash sale is already saved on this phone and waiting to sync. Do not collect again.",
        );
      stateRef.current = saved.state;
      setState(saved.state);
      setPending(
        (await storage.get<storage.Queued[]>(`outbox:${scope()}`)) ?? [],
      );
      if (demo) {
        await storage.set(`outbox:${scope()}`, []);
        setPending([]);
      } else void sync();
      return saved.state.invoices[`${id}:invoice`];
    } finally {
      operating.current = false;
    }
  }
  async function sync() {
    if (demo || syncing.current || !identityRef.current?.lease) return;
    syncing.current = true;
    try {
      let entries =
        (await storage.get<storage.Queued[]>(`outbox:${scope()}`)) ?? [];
      const unresolved = await storage.get<Command>(`online:${scope()}`);
      if (unresolved) {
        try {
          await request("/commands", {
            method: "POST",
            body: JSON.stringify(unresolved),
          });
          await markUncertain(null);
          setError(
            "An action that had no response is now confirmed as saved. Check Orders before collecting again.",
          );
        } catch (e) {
          const status = (e as any).httpStatus;
          if (!status || status >= 500) throw e;
          await markUncertain(null);
          await releaseRejected(unresolved, e);
          setError(
            "An action that had no response was not saved. Check Orders, then try again if needed.",
          );
        }
      }
      if (entries.length) {
        const gateway = stateRef.current?.settings.gatewayUrl;
        if (gateway)
          try {
            for (const entry of entries.filter((e) => e.status === "local")) {
              const r = await fetch(`${gateway}/backup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  lease: entry.lease,
                  command: entry.command,
                }),
                signal: AbortSignal.timeout(3000),
              });
              if (r.ok) entry.status = "gateway";
            }
            const backed = new Set(
              entries
                .filter((e) => e.status === "gateway")
                .map((e) => e.command.id),
            );
            entries = await storage.updateQueue(scope(), (current) =>
              current.map((e) =>
                backed.has(e.command.id) && e.status === "local"
                  ? { ...e, status: "gateway" }
                  : e,
              ),
            );
            setPending([...entries]);
          } catch {
            /* gateway is an additional backup, not the only copy */
          }
        const toSubmit = [...entries];
        for (let offset = 0; offset < toSubmit.length; offset += 25) {
          const result = await request("/sync", {
            method: "POST",
            body: JSON.stringify({
              entries: toSubmit
                .slice(offset, offset + 25)
                .map(({ command, lease }) => ({ command, lease })),
            }),
          });
          const rejected = result.results.filter(
            (r: any) => r.status === "resolved_rejected",
          );
          if (rejected.length)
            setError(
              `Owner reviewed and rejected ${rejected.length} queued sale(s): ${rejected.map((r: any) => r.reason).join("; ")}`,
            );
          const responses = new Map(result.results.map((r: any) => [r.id, r]));
          entries = await storage.updateQueue(scope(), (current) =>
            current
              .filter(
                (e) =>
                  !["synced", "resolved_rejected"].includes(
                    (responses.get(e.command.id) as any)?.status,
                  ),
              )
              .map((e) => {
                const r = responses.get(e.command.id) as any;
                return r?.status === "review_required"
                  ? { ...e, status: "review" as const, error: r.reason }
                  : e;
              }),
          );
          setPending([...entries]);
        }
      }
      if (Date.parse(identityRef.current.expiresAt) - Date.now() < 3600000) {
        const registration = await request("/devices/register", {
          method: "POST",
          body: JSON.stringify({
            id: identityRef.current.deviceId,
            name: `${Platform.OS} employee device`,
            counterId:
              stateRef.current?.devices[identityRef.current.deviceId]
                ?.counterId ?? "counter-1",
          }),
        });
        const renewed = {
          ...identityRef.current,
          lease: registration.lease,
          issuedAt: registration.issuedAt,
          expiresAt: registration.expiresAt,
        };
        identityRef.current = renewed;
        setIdentity(renewed);
        await storage.set("identity", renewed);
      }
      const remote = await storage.get<State>(`remote:${scope()}`);
      const latestQueue =
        (await storage.get<storage.Queued[]>(`outbox:${scope()}`)) ?? [];
      if (!operating.current)
        await request("/devices/heartbeat", {
          method: "POST",
          body: JSON.stringify({
            deviceId: identityRef.current.deviceId,
            pendingCount: latestQueue.length,
            acknowledgedRevision: remote?.revision ?? 0,
          }),
        });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      syncing.current = false;
    }
  }
  useEffect(() => {
    (async () => {
      try {
        const cached = await storage.get<Identity>("identity");
        const savedLanguage = await storage.get<"en" | "hi">("language");
        if (savedLanguage === "en" || savedLanguage === "hi")
          changeLanguage(savedLanguage);
        if (demoRef.current) return;
        if (cached) {
          identityRef.current = cached;
          setIdentity(cached);
          const s = await storage.get<State>(
            `state:${cached.actor.businessId}:${cached.actor.id}`,
          );
          setState(s);
          const q =
            (await storage.get<storage.Queued[]>(
              `outbox:${cached.actor.businessId}:${cached.actor.id}`,
            )) ?? [];
          setPending(q);
          setUncertain(
            await storage.get<Command>(
              `online:${cached.actor.businessId}:${cached.actor.id}`,
            ),
          );
          try {
            await establish();
          } catch {
            setOnline(false);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!identity || demo) return;
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void sync();
    });
    const interval = setInterval(() => {
      void sync();
    }, 30000);
    // A handoff or approval from another counter should show within seconds; an
    // unchanged shop costs one small request.
    const quick = setInterval(() => {
      if (syncing.current || AppState.currentState !== "active") return;
      void refresh().catch(() => {});
    }, 8000);
    return () => {
      sub.remove();
      clearInterval(interval);
      clearInterval(quick);
    };
  }, [identity?.deviceId, demo]);
  return (
    <context.Provider
      value={{
        state,
        identity,
        demo,
        loading,
        online,
        error,
        language,
        pending,
        uncertain,
        login,
        changePassword,
        passwordRequired,
        startDemo,
        logout,
        setLanguage,
        command,
        cashSale,
        sync,
        refresh,
        request,
        setError,
        reserveSequence,
        assignCounter,
      }}
    >
      {children}
    </context.Provider>
  );
}
export const useSession = () => useContext(context);
