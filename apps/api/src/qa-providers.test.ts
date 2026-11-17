import { it, expect, vi, afterEach } from "vitest";
import { transcribe } from "./providers";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
// gpt-4o-transcribe returned the prompt's example medicines for silent audio, and those became sale items.
it("speech prompt names no medicines, so silence cannot echo them into a sale", async () => {
  vi.stubEnv("SARVAM_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "test-only");
  const fetchMock = vi.fn(async () => Response.json({ text: "" }));
  vi.stubGlobal("fetch", fetchMock);
  await transcribe(Buffer.from("x"), "audio/mp4");
  const form = (fetchMock.mock.calls[0] as any)[1].body as FormData;
  const prompt = String(form.get("prompt"));
  expect(prompt).not.toMatch(/Dolo|Cetirizine|Pan 40|Azithral/i);
});
