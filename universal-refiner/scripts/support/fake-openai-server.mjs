import { createServer } from "node:http";

export async function startFakeOpenAiServer(options = {}) {
  const {
    host = "127.0.0.1",
    port = 0,
    responses = {},
    unavailableModels = [],
  } = options;
  const requests = [];
  const unavailable = new Set(unavailableModels);

  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => body += chunk);
    request.on("end", () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      response.setHeader("content-type", "application/json");

      if (unavailable.has(payload.model)) {
        response.writeHead(503).end(JSON.stringify({ error: "model unavailable" }));
        return;
      }

      response.end(JSON.stringify({
        choices: [{ message: { content: responses[payload.model] ?? `response from ${payload.model}` } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      }));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake OpenAI server did not expose a TCP address.");
  }

  return {
    baseUrl: `http://${host}:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}
