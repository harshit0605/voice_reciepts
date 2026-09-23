# API cost policy — researched 23 September 2026

Prices are vendor list prices, not measured cost or pharmacy accuracy. Taxes, provider billing granularity, retries, hosting, support and payment fees are extra.

| Work                                | v1 approach                                                          | Pricing reference                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Speech recognition                  | Existing Sarvam Saaras v3 codemix adapter; evaluate before changing  | [Sarvam](https://docs.sarvam.ai/api/getting-started/pricing): ₹30/hour of speech                                                                           |
| Invoice reading + structured fields | One Gemini multimodal request, no separate OCR/LLM chain             | [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite): $0.10/M text/image/video input tokens, $0.40/M output tokens |
| Transcript structure                | Configurable small Gemini model; keep catalogue and arithmetic local | Same Flash-Lite rates for text                                                                                                                             |
| Candidate decisions                 | Jev is a future experiment, not integrated                           | [OpenRouter Jev 1.13](https://openrouter.ai/typesafe/jev-1.13): $0.042/M input, $0 output                                                                  |

Jev accepts text and chooses from defined options. It does not generate arbitrary invoice text or item arrays. TypeSafe specifically advises keeping arithmetic in code and using a generative model for free-form extraction: [documented limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13). It may later rerank a short catalogue candidate list, with a none-of-these option and human confirmation. No claim about Hindi medicine matching is established.

## Why unlimited speech can break a low-price plan

Illustrative 30-day months using ₹30/hour (no rounding/minimums assumed):

- 100 voice sales/day × 8 seconds = 6.67 hours/month, about ₹200 for transcription alone.
- 200 voice sales/day × 10 seconds = 16.67 hours/month, about ₹500 for transcription alone.
- A one-page invoice taking 2,000 input and 1,000 output tokens on Flash-Lite would cost $0.0006; 100 such invoices would cost $0.06. These are assumed token counts, not benchmark results.

Do not offer unlimited AI in a ₹499 plan based on these examples. Track actual use first; choose included audio minutes/pages and a paid allowance after field measurements. Search, barcode, manual receiving, arithmetic, permissions and reconciliation need no AI calls. Gboard dictation can provide text through the normal keyboard field, but it is not a guaranteed free/offline cross-platform speech SDK.

## Controls implemented

- Invoice content hashes reuse prior jobs/results within one business; voice reuse is additionally scoped to the employee and sale draft, so identical utterances for different customers remain separate. Concurrent identical uploads create one job.
- Saved native receiving drafts and resumable server jobs avoid re-uploading after screen closure or connection loss. Browser preview storage is memory-only.
- Configurable per-business monthly new-job limits: `INVOICE_MONTHLY_LIMIT` (100 default), `VOICE_MONTHLY_LIMIT` (3000 default). India calendar months. This is an operational allowance, **not a rupee spend cap**; file complexity and retries change cost.
- `INVOICE_MODEL` / `STRUCTURE_MODEL` override legacy `GEMINI_MODEL`; absent configuration falls back to Flash-Lite. Existing installations with `GEMINI_MODEL=gemini-2.5-flash` retain that selection unless explicitly changed. No silent fallback to expensive models.
- Freeze selected model in each job, cap output tokens (12,000 invoice / 3,000 voice), disable thinking on these supported 2.5 models, and apply a provider timeout.
- Retry only transient provider failures automatically, with at most two attempts. Owner can explicitly retry failed invoice jobs up to three attempts total. Missing credentials, invalid JSON and schema errors are terminal; there is no extra paid repair call.
- Successful results retain provider/model, reported token usage and worker latency. Jobs retain attempt counts; failed calls may still incur charges without returning token usage. No exhaustive provider-invoice reconciliation or monetary budget reservation is implemented yet.
- Pack conversion, totals, expiry checks and product candidate retrieval run in ordinary code, not an LLM.

## Quality and deployment boundary

Provider request/response contracts are tested with controlled responses; no live Sarvam, Gemini or Jev call was made for this pass. Obtain keys and separately consented invoice/voice evaluation samples before choosing a paid default on accuracy. The cheaper model is a configurable candidate, not a proven replacement. Mistral/dedicated OCR and self-hosting remain alternatives to evaluate if one-pass extraction quality or actual cost warrants another pipeline.

Next cost work: independently measure audio duration, PDF page count, all provider attempts and actual billed spend; add per-plan minute/page budgets and operator cost alerts. An upload byte cap alone does not bound PDF page count.

## Voice pass controls

- Exact catalogue-name/strength + quantity/unit text is parsed locally. This narrow path supports known Hindi units/numbers, semicolon/newline-separated items, and works without an API. Ambiguity falls back to cloud extraction or manual selection; it never guesses a substitute.
- Typed/pasted/keyboard-dictated text goes directly to structure extraction when the local parser cannot resolve it. No Sarvam call is made for text. Keyboard dictation availability, privacy and offline support depend on the phone/keyboard provider.
- Recordings stop at 28 seconds in the client. The API validates a client-reported duration of at most 30 seconds and reserves 60 seconds per new audio job for at most two attempts. `VOICE_MONTHLY_RESERVED_SECONDS=18000` defaults to 300 new recordings per shop per India calendar month. Reservations are conservative and are not refunded after success; typed entries remain available after the speech allowance is exhausted.
- The allowance is a reservation policy, not verified billable minutes or a monetary cap. Uploaded audio duration is not independently decoded; provider rounding and interrupted calls can differ. Independently validate media duration before treating the allowance as a hard spend boundary.
- Speech-call attempts are recorded before calls. A successful transcript is saved before structuring and operational audio is removed then; structure retries reuse that checkpoint. Terminal failed jobs also remove their audio. A crash after STT but before its database checkpoint can still result in one repeat call within the bounded attempt limit.
- The owning employee can resume recent jobs. A structure failure preserves recognised text for correction. Basket and remaining voice items are saved together in native encrypted storage; browser preview storage remains memory-only. Pending audio uploads can be retried while the Sell screen is mounted, but raw recordings are not a durable offline upload queue.
