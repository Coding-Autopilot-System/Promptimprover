import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  LocalOpenAiProvider,
  SemanticProvider,
  SemanticProviderChain,
  McpSamplingProvider,
} from "../src/core/semantic-provider.js";

describe("semantic providers", () => {
  let server: Server | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
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

  it("rejects malformed local endpoint URLs and permits explicit remote endpoints", () => {
    const options = {
      models: ["gemma3:12b"],
      timeoutMs: 1000,
      temperature: 0.2,
    };

    expect(() => new LocalOpenAiProvider({
      ...options,
      baseUrl: "not a valid URL",
      allowNonLoopback: false,
    })).toThrow(/loopback/);
    expect(() => new LocalOpenAiProvider({
      ...options,
      baseUrl: "https://example.com/v1",
      allowNonLoopback: true,
    })).not.toThrow();
  });

  it.each([
    "http://localhost:11434/v1",
    "http://[::1]:11434/v1",
  ])("accepts loopback endpoint %s", baseUrl => {
    expect(() => new LocalOpenAiProvider({
      baseUrl,
      models: ["gemma3:12b"],
      timeoutMs: 1000,
      temperature: 0.2,
      allowNonLoopback: false,
    })).not.toThrow();
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

  it("rejects malformed local responses and exhausts configured models", async () => {
    server = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: " " } }] }));
    });
    await new Promise<void>(resolve => server?.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const provider = new LocalOpenAiProvider({
      baseUrl: `http://127.0.0.1:${port}/v1/`,
      models: ["bad"],
      timeoutMs: 1000,
      temperature: 0,
      allowNonLoopback: false,
    });

    await expect(provider.requestText({ taskName: "malformed", prompt: "hello", maxTokens: 10 })).resolves.toBeNull();
  });

  it("rejects non-string model content and handles non-Error request failures", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 42 } }] }),
      })
      .mockRejectedValueOnce("connection lost"));
    const provider = new LocalOpenAiProvider({
      baseUrl: "http://localhost:11434/v1",
      models: ["non-string", "offline"],
      timeoutMs: 1000,
      temperature: 0,
      allowNonLoopback: false,
    });

    await expect(provider.requestText({ taskName: "invalid", prompt: "hello", maxTokens: 10 })).resolves.toBeNull();
  });

  it("supports MCP sampling and records provider-chain telemetry", async () => {
    const onSuccess = vi.fn();
    const sampling = new McpSamplingProvider(async () => "sampled");
    const chain = new SemanticProviderChain([
      { name: "offline", requestText: async () => null },
      sampling,
    ], onSuccess);
    const request = { taskName: "sample", prompt: "hello", maxTokens: 10 };

    await expect(chain.requestText(request)).resolves.toBe("sampled");
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "mcp-sampling", fallbackFrom: ["provider:offline"] }),
      request,
    );
  });

  it("maps model fallbacks from a successful provider response", async () => {
    const chain = new SemanticProviderChain([{
      name: "provider",
      requestText: async () => ({
        text: "ready",
        provider: "provider",
        model: "fallback",
        latencyMs: 1,
        fallbackFrom: ["primary"],
      }),
    }]);
    await expect(chain.requestText({ taskName: "fallback", prompt: "x", maxTokens: 1 })).resolves.toBe("ready");
  });

  it("returns null when MCP sampling and every provider are unavailable", async () => {
    const sampling = new McpSamplingProvider(async () => null);
    const chain = new SemanticProviderChain([sampling]);
    await expect(chain.requestText({ taskName: "offline", prompt: "hello", maxTokens: 10 })).resolves.toBeNull();
  });

  it("propagates sampling failures to the caller", async () => {
    const failure = new Error("sampling failed");
    const sampling = new McpSamplingProvider(async () => {
      throw failure;
    });

    await expect(sampling.requestText({ taskName: "sample", prompt: "hello", maxTokens: 10 }))
      .rejects.toBe(failure);
  });
});
