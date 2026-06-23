import { EventStore } from "../../dist/src/history/event-store.js";

const workerId = process.argv[2];
const durationMs = Number.parseInt(process.argv[3] || "10000", 10);
const minOperations = Number.parseInt(process.argv[4] || "0", 10);
const deadline = Date.now() + durationMs;
const counts = { events: 0, prompts: 0, executions: 0, operations: 0 };
const store = EventStore.getInstance();
let index = 0;
let lastPromptId;

while (Date.now() < deadline || counts.operations < minOperations) {
  const id = `soak-${workerId}-${index}`;
  const operation = index % 3;

  if (operation === 0) {
    lastPromptId = `prompt-${id}`;
    store.recordPrompt({
      id: lastPromptId,
      client: "soak-worker",
      raw_prompt: `mixed operation prompt ${id}`,
    });
    counts.prompts += 1;
  } else if (operation === 1) {
    store.recordExecution({
      id: `execution-${id}`,
      prompt_id: lastPromptId,
      workflow_name: "soak",
      executor_name: `worker-${workerId}`,
      status: "completed",
    });
    counts.executions += 1;
  } else {
    store.recordEvent({
      id: `event-${id}`,
      event_type: "soak_mixed",
      prompt_id: lastPromptId,
      summary: `mixed operation event ${id}`,
    });
    counts.events += 1;
  }

  counts.operations += 1;
  index += 1;
}

store.close();
console.log(JSON.stringify({ workerId, ...counts }));
