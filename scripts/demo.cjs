const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const children = [];

function reachable(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}

async function waitFor(port, label, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await reachable(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs / 1000}s`);
}

function launch(command, args, label, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
  children.push(child);
  child.once("exit", (code) => {
    if (code && code !== 130) console.error(`${label} exited with code ${code}`);
  });
  return child;
}

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill("SIGINT");
  }
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

(async () => {
  if (await reachable(8545) || await reachable(3000)) {
    throw new Error("Ports 8545 or 3000 are already in use. Stop the existing demo processes first.");
  }

  console.log("Starting isolated Hardhat chain on 127.0.0.1:8545...");
  launch(process.execPath, [
    path.join(root, "node_modules", "hardhat", "internal", "cli", "bootstrap.js"),
    "node", "--config", "hardhat.config.cjs", "--hostname", "127.0.0.1"
  ], "Hardhat");
  await waitFor(8545, "Hardhat chain");

  console.log("Starting BREAKPOINT on 127.0.0.1:3000...");
  launch(process.execPath, [
    path.join(root, "node_modules", "next", "dist", "bin", "next"),
    "dev", "--hostname", "127.0.0.1"
  ], "Next.js", path.join(root, "apps", "web"));
  await waitFor(3000, "BREAKPOINT web app");

  console.log("\nBREAKPOINT is ready: http://127.0.0.1:3000");
  console.log("All fixture transactions remain on chain 31337. Press Ctrl+C to stop both processes.\n");
})().catch((error) => {
  console.error(error.message);
  shutdown();
  process.exitCode = 1;
});
