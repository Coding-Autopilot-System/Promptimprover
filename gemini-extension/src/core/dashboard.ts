import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { LocalBrain } from "../memory/local-brain.js";
import { AgenticBlackboard } from "./blackboard.js";
import { ArchitecturalScout, NodeDetector, PythonDetector } from "../detectors/project-scout.js";

export class CommandCenterDashboard {
  static start(port = 3000) {
    const app = new Hono();

    app.get("/", async (c) => {
      const patterns = LocalBrain.getPatterns();
      const intents = AgenticBlackboard.getActiveIntents();
      const arch = await ArchitecturalScout.detectPatterns();
      const node = await NodeDetector.detect();
      const py = await PythonDetector.detect();

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>PromptImprover | Command Center</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; }
            .card { background: #1e293b; padding: 1.5rem; border-radius: 0.75rem; border: 1px solid #334155; }
            h1 { color: #38bdf8; margin-top: 0; }
            h2 { color: #94a3b8; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
            .tag { display: inline-block; background: #0369a1; color: #bae6fd; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; margin-right: 0.5rem; }
            pre { background: #000; padding: 1rem; border-radius: 0.5rem; font-size: 0.875rem; overflow-x: auto; }
            .status { color: #22c55e; font-weight: bold; }
          </style>
          <meta http-equiv="refresh" content="10">
        </head>
        <body>
          <header>
            <h1>🚀 PromptImprover v6.0</h1>
            <p>Status: <span class="status">Live Control Tower</span> | Port: ${port}</p>
          </header>

          <div class="grid">
            <div class="card">
              <h2>Agentic Blackboard (Active Sessions)</h2>
              ${intents.length === 0 ? "<p>No active agents detected.</p>" : intents.map(i => `
                <div>
                  <strong>${i.agentName}</strong> (${i.toolType})<br/>
                  <small>${i.timestamp}</small>
                  <pre>${i.intent}</pre>
                </div>
              `).join("<hr/>")}
            </div>

            <div class="card">
              <h2>Learned Patterns (Memory Vault)</h2>
              ${patterns.length === 0 ? "<p>No patterns learned yet.</p>" : patterns.map(p => `
                <p><span class="tag">${p.category}</span> <strong>${p.id}</strong><br/>${p.description}</p>
              `).join("")}
            </div>

            <div class="card">
              <h2>Project DNA (Auto-Scout)</h2>
              <p><strong>Language</strong>: ${node.language || py.language || "Unknown"}</p>
              <p><strong>Framework</strong>: ${node.framework || py.framework || "Unknown"}</p>
              <p><strong>Architecture</strong>: ${arch.join(", ")}</p>
            </div>
          </div>
        </body>
        </html>
      `;
      return c.html(html);
    });

    serve({ fetch: app.fetch, port });
    console.error(`[CommandCenter] Dashboard live at http://localhost:${port}`);
  }
}
