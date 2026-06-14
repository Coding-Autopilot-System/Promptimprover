import { afterEach, describe, expect, it } from "vitest";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  LocalOpenAiProvider,
  SemanticProvider,
  SemanticProviderChain,
} from "../src/core/semantic-provider.js";

describe("semantic providers", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
      server = undefined;
    }
  });

  it("rejects non-loopback local endpoints by default", () => {
    expect(() => new LocalOpenAiProvider({
      baseUrl: "https://example.com/v1",
      models: ["gemma3:12b"],
      timeoutMs: 1000,
      temperature: 0.2,
      allowNonLoopback: false,
    })).toThrow(/loopback/);
  });

  it("falls back to the next configured local model", async () => {
    const requestedModels: string[] = [];
    server = createServer((request, response) => {
      let body = "";
      request.on("data", chunk => body += chunk);
      request.on("end", () => {
        const payload = JSON.parse(body);
        requestedModels.push(payload.model);
        response.setHeader("content-type", "application/json");
        if (payload.model === "gemma3:12b") {
          response.statusCode = 503;
          response.end(JSON.stringify({ error: "unavailable" }));
          return;
        }
        response.end(JSON.stringify({
          choices: [{ message: { content: "fallback response" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }));
      });
    });
    await new Promise<void>(resolve => server?.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const provider = new LocalOpenAiProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      models: ["gemma3:12b", "gemma3:1b"],
      timeoutMs: 1000,
      temperature: 0.2,
      allowNonLoopback: false,
    });

    const result = await provider.requestText({ taskName: "test", prompt: "hello", maxTokens: 10 });

    expect(requestedModels).toEqual(["gemma3:12b", "gemma3:1b"]);
    expect(result?.text).toBe("fallback response");
    expect(result?.model).toBe("gemma3:1b");
    expect(result?.fallbackFrom).toEqual(["gemma3:12b"]);
  });

  it("falls through provider chain when a provider is unavailable", async () => {
    const unavailable: SemanticProvider = {
      name: "unavailable",
      requestText: async () => null,
    };
    const available: SemanticProvider = {
      name: "available",
      requestText: async () => ({
        text: "ready",
        provider: "available",
        model: "test",
        latencyMs: 1,
      }),
    };

    const chain = new SemanticProviderChain([unavailable, available]);
    await expect(chain.requestText({ taskName: "test", prompt: "hello", maxTokens: 10 })).resolves.toBe("ready");
  });
});
