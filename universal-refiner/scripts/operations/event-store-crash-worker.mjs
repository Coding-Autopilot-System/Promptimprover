import { EventStore } from "../../dist/src/history/event-store.js";

const writes = Number.parseInt(process.argv[2] || "25", 10);
const store = EventStore.getInstance();

for (let index = 0; index < writes; index += 1) {
  store.recordEvent({
    id: `abrupt-${index}`,
    event_type: "abrupt_recovery",
    summary: `durable before abrupt termination ${index}`,
  });
}

console.log(JSON.stringify({ ready: true, writes }));
setInterval(() => undefined, 60_000);
