import { bootstrap, demoTenant, getOrCreateSession } from "./api/_lib.js";

async function run() {
  try {
    const { orchestrator, logger } = await bootstrap();
    const tenant = demoTenant();
    const session = await getOrCreateSession("test-session", tenant, "full-page");
    
    // Hook into the orchestrator's event emitter to see what's failing
    orchestrator.on((event) => {
      console.log(`[Event: ${event.kind}]`, event.data || "", event.error ? `Error: ${event.error}` : "");
    });

    console.log("Calling handleTurn...");
    const result = await orchestrator.handleTurn({
      session,
      tenant,
      customerMessage: "Birthday cake",
    });
    console.log("\n--- Final Reply ---");
    console.log(result.reply);
    console.log("\n--- Candidates in Plan ---");
    console.log(JSON.stringify(result.plan.candidatesBySlot, null, 2));
  } catch (err) {
    console.error("Error in turn:", err);
  }
}

run();