import { it, expect, vi, afterEach } from "vitest";
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  },
}));
import { extract } from "./providers";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  generate.mockReset();
});
it("passes invoice bytes to a single bounded call and validates the review draft", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  const draft = {
    supplierName: "Test",
    supplierGstin: null,
    invoiceNumber: "1",
    invoiceDate: null,
    totalPaise: null,
    lines: [],
    warnings: ["Unreadable"],
  };
  generate.mockResolvedValue({
    text: JSON.stringify(draft),
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 },
  });
  const output = await extract(
    "invoice",
    Buffer.from("synthetic invoice"),
    "application/pdf",
    "gemini-2.5-flash-lite",
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0]).toMatchObject({
    model: "gemini-2.5-flash-lite",
    config: {
      temperature: 0,
      maxOutputTokens: 12000,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  expect(output).toMatchObject({
    draft,
    requiresReview: true,
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
  });
});
it("rejects malformed structured output instead of posting or repairing it with another paid call", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  generate.mockResolvedValue({ text: '{"lines":"wrong"}' });
  await expect(
    extract("invoice", Buffer.from("test"), "image/png"),
  ).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});
it("uses Sarvam codemix before structured voice extraction and never sends audio to Gemini", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("SARVAM_API_KEY", "test-only");
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ transcript: "Dolo six goli" })),
    );
  vi.stubGlobal("fetch", fetch);
  generate.mockResolvedValue({
    text: JSON.stringify({
      items: [
        {
          name: "Dolo",
          strength: null,
          form: null,
          quantity: "6",
          unit: "goli",
          uncertain: true,
        },
      ],
      warnings: [],
    }),
  });
  const output = await extract("voice", Buffer.from("audio"), "audio/mp4");
  expect(fetch.mock.calls[0][1].body.get("mode")).toBe("codemix");
  expect(output.transcript).toBe("Dolo six goli");
  expect(generate.mock.calls[0][0].contents[0].parts[1]).toEqual({
    text: "Dolo six goli",
  });
});
it("fails explicitly when the provider is not configured", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  await expect(
    extract("invoice", Buffer.from("x"), "image/png"),
  ).rejects.toThrow("not configured");
  expect(generate).not.toHaveBeenCalled();
});
it("does not send empty speech or raw audio to the structure provider", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("SARVAM_API_KEY", "test-only");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ transcript: "" }))),
  );
  await expect(
    extract("voice", Buffer.from("silence"), "audio/mp4"),
  ).rejects.toThrow("No speech");
  expect(generate).not.toHaveBeenCalled();
});
