import { afterEach, describe, expect, it } from "vitest";
import { startFakeOpenAiServer } from "../../scripts/support/fake-openai-server.mjs";
import {
  LocalOpenAiProvider,
  SemanticProvider,
  SemanticProviderChain,
} from "../../src/core/semantic-provider.js";

describe("semantic provider acceptance", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.close()));
  });

  it.each(["gemma3:12b", "gemma3:1b"])("accepts configured local model %s", async model => {
    const fake = await startFakeOpenAiServer({ responses: { [model]: `${model} accepted` } });
    servers.push(fake);
    const provider = new LocalOpenAiProvider({
      baseUrl: fake.baseUrl,
      models: [model],
      timeoutMs: 1000,
      temperature: 0,
      allowNonLoopback: false,
    });

    await expect(provider.requestText({ taskName: "acceptance", prompt: "hello", maxTokens: 20 }))
      .resolves.toMatchObject({ text: `${model} accepted`, model });
  });

  it("falls back across models and then across providers during outages", async () => {
    const fake = await startFakeOpenAiServer({ unavailableModels: ["gemma3:12b", "gemma3:1b"] });
    servers.push(fake);
    const local = new LocalOpenAiProvider({
      baseUrl: fake.baseUrl,
      models: ["gemma3:12b", "gemma3:1b"],
      timeoutMs: 1000,
      temperature: 0,
      allowNonLoopback: false,
    });
    const fallback: SemanticProvider = {
      name: "deterministic-test",
      requestText: async () => ({
        text: "fallback accepted",
        provider: "deterministic-test",
        model: "none",
        latencyMs: 0,
      }),
    };

    await expect(new SemanticProviderChain([local, fallback])
      .requestText({ taskName: "outage", prompt: "hello", maxTokens: 20 }))
      .resolves.toBe("fallback accepted");
    expect(fake.requests.map(request => request.model)).toEqual(["gemma3:12b", "gemma3:1b"]);
  });
});
