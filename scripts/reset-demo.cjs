const { randomUUID } = require("node:crypto");

const base = "http://127.0.0.1:3000/api/scenario";

async function post(action, body, token) {
  const response = await fetch(`${base}/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-breakpoint-session": token } : {})
    },
    body: JSON.stringify({ ...body, operationId: randomUUID() })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `${action} failed (${response.status})`);
  return result;
}

(async () => {
  const current = await post("start", {});
  const reset = await post("reset", { expectedRunId: current.snapshot.runId }, current.sessionToken);
  console.log(`Fresh run ready: ${reset.snapshot.runId}`);
  console.log(`Pinned block: ${reset.snapshot.blockNumber} (${reset.snapshot.blockHash})`);
})().catch((error) => {
  console.error(`Unable to reset BREAKPOINT: ${error.message}`);
  console.error("Start the local demo first with: npm run demo");
  process.exitCode = 1;
});
