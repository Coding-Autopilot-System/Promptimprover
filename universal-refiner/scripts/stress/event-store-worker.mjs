import { EventStore } from "../../dist/src/history/event-store.js";

const workerId = process.argv[2];
const writes = Number.parseInt(process.argv[3] || "100", 10);
const store = EventStore.getInstance();

for (let index = 0; index < writes; index += 1) {
  store.recordEvent({
    id: `worker-${workerId}-${index}`,
    event_type: "stress",
    summary: `worker ${workerId} event ${index}`,
  });
}

store.close();
