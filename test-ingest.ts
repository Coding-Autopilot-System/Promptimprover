import { CommitIngester } from "./universal-refiner/src/history/commit-ingest.ts";
import { EventStore } from "./universal-refiner/src/history/event-store.ts";

async function testIngest() {
  console.log("Testing Commit Ingester...");
  const count = await CommitIngester.ingestLatest(".", 5);
  console.log(`Successfully ingested ${count} commits.`);
  
  const db = (EventStore.getInstance() as any).db;
  const commits = db.prepare("SELECT * FROM commits LIMIT 5").all();
  console.log("Sample Commits in DB:");
  console.table(commits.map((c: any) => ({
    sha: c.sha.substring(0, 7),
    author: c.author,
    message: c.message.substring(0, 30)
  })));
  
  EventStore.getInstance().close();
}

testIngest().catch(console.error);
