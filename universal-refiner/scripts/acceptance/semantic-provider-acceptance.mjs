import assert from "node:assert/strict";
import { startFakeOpenAiServer } from "../support/fake-openai-server.mjs";
import {
  LocalOpenAiProvider,
  SemanticProviderChain,
} from "../../dist/src/core/semantic-provider.js";

const primary = process.env.PROMPT_REFINER_PRIMARY_MODEL || "gemma3:12b";
const fallback = process.env.PROMPT_REFINER_FALLBACK_MODEL || "gemma3:1b";
const liveBaseUrl = process.env.PROMPT_REFINER_ACCEPTANCE_BASE_URL;
const fake = await startFakeOpenAiServer({
  unavailableModels: [primary],
  responses: { [fallback]: "fallback accepted" },
});

try {
  if (liveBaseUrl) {
    for (const model of [primary, fallback]) {
      const liveProvider = new LocalOpenAiProvider({
        baseUrl: liveBaseUrl,
        models: [model],
        timeoutMs: Number.parseInt(process.env.PROMPT_REFINER_ACCEPTANCE_TIMEOUT_MS || "120000", 10),
        temperature: 0,
        allowNonLoopback: process.env.PROMPT_REFINER_ACCEPTANCE_ALLOW_NON_LOOPBACK === "true",
      });
      const liveResult = await liveProvider.requestText({ taskName: "live acceptance", prompt: "Reply with accepted.", maxTokens: 16 });
      assert.equal(liveResult?.model, model, `Live endpoint did not return a response from ${model}.`);
    }
    console.log(`Live semantic acceptance passed for ${primary} and ${fallback} at ${liveBaseUrl}.`);
  }

  const local = new LocalOpenAiProvider({
    baseUrl: fake.baseUrl,
    models: [primary, fallback],
    timeoutMs: 2000,
    temperature: 0,
    allowNonLoopback: false,
  });
  const lastResort = {
    name: "acceptance-fallback",
    requestText: async () => ({
      text: "provider fallback accepted",
      provider: "acceptance-fallback",
      model: "deterministic",
      latencyMs: 0,
    }),
  };

  const localResult = await local.requestText({ taskName: "acceptance", prompt: "hello", maxTokens: 16 });
  assert.equal(localResult?.model, fallback);
  assert.deepEqual(localResult?.fallbackFrom, [primary]);

  const outageProvider = new LocalOpenAiProvider({
    baseUrl: "http://127.0.0.1:1/v1",
    models: [primary, fallback],
    timeoutMs: 100,
    temperature: 0,
    allowNonLoopback: false,
  });
  const chainResult = await new SemanticProviderChain([outageProvider, lastResort])
    .requestText({ taskName: "outage", prompt: "hello", maxTokens: 16 });
  assert.equal(chainResult, "provider fallback accepted");

  console.log(`Semantic acceptance passed: ${primary} -> ${fallback} and outage provider fallback.`);
} finally {
  await fake.close();
}
