import { transact } from "@counterwell/db";
import type { Notice, State } from "@counterwell/core";
import { deliver } from "./push";

/** Sends notices after the change is saved, and forgets phones Apple or Google no longer know. */
export async function notify(
  businessId: string,
  state: State,
  notices: Notice[],
) {
  try {
    const gone = await deliver(state, notices);
    if (gone.length) {
      // Phones then ask for a new token at their next refresh.
      console.info(
        JSON.stringify({ event: "push_tokens_dropped", count: gone.length }),
      );
      await transact(businessId, (s) => {
        const next = structuredClone(s);
        for (const d of Object.values(next.devices))
          if (d.pushToken && gone.includes(d.pushToken)) {
            delete d.pushToken;
            delete d.pushPlatform;
          }
        return { state: next, result: true };
      });
    }
  } catch (e) {
    console.warn(
      JSON.stringify({ event: "notify_failed", error: (e as Error).message }),
    );
  }
}
