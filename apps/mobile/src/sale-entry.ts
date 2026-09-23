import { useEffect, useRef, useState } from "react";
import { emptyVoice, type SaleEntry } from "@counterwell/core";
import { uid } from "./session";
import * as storage from "./storage";
export function useSaleEntry(key: string) {
  const [entry, setEntry] = useState<SaleEntry>(() => ({
    basket: [],
    voice: emptyVoice(uid()),
    checkoutInterrupted: false,
  }));
  const ref = useRef(entry),
    mounted = useRef(true),
    writes = useRef(Promise.resolve()),
    version = useRef(0);
  const [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [reviewRecovery, setReviewRecovery] = useState(false);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    void storage
      .get<SaleEntry>(key)
      .then((saved) => {
        if (!live) return;
        if (saved) {
          ref.current = saved;
          setEntry(saved);
          setReviewRecovery(saved.basket.length > 0);
        }
        setReady(true);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [key]);
  async function update(
    change: (old: SaleEntry) => SaleEntry,
  ): Promise<boolean> {
    const next = change(ref.current),
      v = ++version.current;
    ref.current = next;
    if (mounted.current) {
      setEntry(next);
      setSaving(true);
    }
    const operation = writes.current
      .catch(() => {})
      .then(() => storage.set(key, next));
    writes.current = operation;
    try {
      await operation;
      if (mounted.current && v === version.current) {
        setSaving(false);
        setError("");
      }
      return true;
    } catch (e) {
      if (mounted.current) {
        setSaving(false);
        setError("Draft could not be saved. Retry before collecting payment.");
      }
      return false;
    }
  }
  return {
    entry,
    update,
    ready,
    saving,
    error,
    reviewRecovery,
    setReviewRecovery,
  };
}
