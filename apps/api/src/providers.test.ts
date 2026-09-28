import { it, expect, vi, afterEach } from "vitest";
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generate };
  },
}));
import { extract, decodingSchema } from "./providers";
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
  vi.stubEnv("OPENROUTER_API_KEY", "");
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
const openRouterReply = (content: string, status = 200) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0001 },
    }),
    { status },
  );
const invoiceDraft = {
  supplierName: "Test",
  supplierGstin: null,
  invoiceNumber: "1",
  invoiceDate: null,
  totalPaise: null,
  lines: [],
  warnings: [],
};
it("uses OpenRouter when only its key is set, with the same model family and a schema-bound reply", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only");
  const fetch = vi
    .fn()
    .mockResolvedValue(openRouterReply(JSON.stringify(invoiceDraft)));
  vi.stubGlobal("fetch", fetch);
  const output = await extract(
    "invoice",
    Buffer.from("photo"),
    "image/jpeg",
    "gemini-2.5-flash-lite",
  );
  expect(generate).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(init.headers.Authorization).toBe("Bearer test-only");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({
    model: "google/gemini-2.5-flash-lite",
    temperature: 0,
    max_tokens: 12000,
    reasoning: { effort: "none" },
    response_format: { type: "json_schema" },
    provider: { require_parameters: true, data_collection: "deny" },
  });
  expect(body.messages[0].content[1]).toEqual({
    type: "image_url",
    image_url: {
      url: `data:image/jpeg;base64,${Buffer.from("photo").toString("base64")}`,
    },
  });
  expect(body.plugins).toBeUndefined();
  expect(output).toMatchObject({
    draft: invoiceDraft,
    requiresReview: true,
    provider: "openrouter",
    model: "google/gemini-2.5-flash-lite",
  });
});
it("sends a PDF to the model itself rather than a paid OCR plugin", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only");
  const fetch = vi
    .fn()
    .mockResolvedValue(
      openRouterReply("```json\n" + JSON.stringify(invoiceDraft) + "\n```"),
    );
  vi.stubGlobal("fetch", fetch);
  const output = await extract(
    "invoice",
    Buffer.from("%PDF"),
    "application/pdf",
  );
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.messages[0].content[1].type).toBe("file");
  expect(body.plugins).toEqual([
    { id: "file-parser", pdf: { engine: "native" } },
  ]);
  expect(output.draft).toEqual(invoiceDraft);
});
it("rejects an OpenRouter error or malformed draft without a second paid call", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only");
  const fetch = vi.fn().mockResolvedValue(openRouterReply("", 402));
  vi.stubGlobal("fetch", fetch);
  await expect(
    extract("invoice", Buffer.from("x"), "image/png"),
  ).rejects.toThrow("returned 402");
  fetch.mockResolvedValue(openRouterReply('{"lines":"wrong"}'));
  await expect(
    extract("invoice", Buffer.from("x"), "image/png"),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("gives the model the draft's shape without value limits, which zod still enforces", async () => {
  const { z } = await import("zod");
  const { invoiceDraftSchema } = await import("@counterwell/core");
  const shape = JSON.stringify(
    decodingSchema(z.toJSONSchema(invoiceDraftSchema)),
  );
  expect(shape).not.toMatch(/"(maxItems|minimum|maximum|\$schema)"/);
  expect(shape).toContain('"batchCode"');
  expect(
    decodingSchema({
      properties: { format: { type: "string", format: "date" } },
    }),
  ).toEqual({
    properties: { format: { type: "string" } },
  });
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-only");
  const tooMany = {
    ...invoiceDraft,
    lines: Array(501).fill({
      name: "Dolo",
      strength: null,
      batchCode: null,
      expiry: null,
      quantity: "1",
      bonusQuantity: null,
      unit: null,
      packSize: null,
      mrpPaise: null,
      lineTotalPaise: null,
      taxBps: 1.5,
    }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(openRouterReply(JSON.stringify(tooMany))),
  );
  await expect(
    extract("invoice", Buffer.from("x"), "image/png"),
  ).rejects.toThrow();
});
