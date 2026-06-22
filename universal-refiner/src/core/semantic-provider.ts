import { RuntimeLogger } from "./logger.js";

export interface SemanticRequest {
  taskName: string;
  prompt: string;
  maxTokens: number;
}

export interface SemanticResponse {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  fallbackFrom?: string[];
}

export interface SemanticProvider {
  readonly name: string;
  requestText(request: SemanticRequest): Promise<SemanticResponse | null>;
}

export interface LocalOpenAiProviderOptions {
  baseUrl: string;
  models: string[];
  timeoutMs: number;
  temperature: number;
  allowNonLoopback: boolean;
}

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LocalOpenAiProvider implements SemanticProvider {
  readonly name = "local-openai";
  private readonly options: LocalOpenAiProviderOptions;

  constructor(options: LocalOpenAiProviderOptions) {
    if (!options.allowNonLoopback && !isLoopbackUrl(options.baseUrl)) {
      throw new Error("Local semantic provider base URL must use a loopback host unless allowNonLoopback is enabled.");
    }
    this.options = options;
  }

  async requestText(request: SemanticRequest): Promise<SemanticResponse | null> {
    const failedModels: string[] = [];
    for (const model of this.options.models) {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: request.prompt }],
            stream: false,
            temperature: this.options.temperature,
            max_tokens: request.maxTokens,
            keep_alive: -1,
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json() as {
          choices?: Array<{ message?: { content?: unknown } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = payload.choices?.[0]?.message?.content;
        if (typeof text !== "string" || text.trim().length === 0) {
          throw new Error("Response did not contain assistant text.");
        }

        return {
          text,
          provider: this.name,
          model,
          latencyMs: Date.now() - startedAt,
          promptTokens: payload.usage?.prompt_tokens,
          completionTokens: payload.usage?.completion_tokens,
          fallbackFrom: failedModels,
        };
      } catch (error) {
        failedModels.push(model);
        RuntimeLogger.warn(`${request.taskName} local model attempt failed`, {
          provider: this.name,
          model,
          latencyMs: Date.now() - startedAt,
          error: getErrorMessage(error),
        });
      }
    }

    return null;
  }
}

export class McpSamplingProvider implements SemanticProvider {
  readonly name = "mcp-sampling";
  private readonly sample: (prompt: string, maxTokens: number) => Promise<string | null>;

  constructor(sample: (prompt: string, maxTokens: number) => Promise<string | null>) {
    this.sample = sample;
  }

  async requestText(request: SemanticRequest): Promise<SemanticResponse | null> {
    const startedAt = Date.now();
    const text = await this.sample(request.prompt, request.maxTokens);
    if (!text) {
      return null;
    }

    return {
      text,
      provider: this.name,
      model: "client-selected",
      latencyMs: Date.now() - startedAt,
    };
  }
}

export class SemanticProviderChain {
  private readonly providers: SemanticProvider[];
  private readonly onSuccess?: (response: SemanticResponse, request: SemanticRequest) => void;

  constructor(
    providers: SemanticProvider[],
    onSuccess?: (response: SemanticResponse, request: SemanticRequest) => void,
  ) {
    this.providers = providers;
    this.onSuccess = onSuccess;
  }

  async requestText(request: SemanticRequest): Promise<string | null> {
    const unavailableProviders: string[] = [];
    for (const provider of this.providers) {
      const response = await provider.requestText(request);
      if (response) {
        response.fallbackFrom = [
          ...unavailableProviders.map(name => `provider:${name}`),
          ...(response.fallbackFrom || []).map(model => `model:${model}`),
        ];
        this.onSuccess?.(response, request);
        return response.text;
      }
      unavailableProviders.push(provider.name);
    }

    RuntimeLogger.warn(`${request.taskName} exhausted all semantic providers`);
    return null;
  }
}
