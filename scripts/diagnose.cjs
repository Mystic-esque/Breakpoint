const { execFileSync } = require("node:child_process");
function version(command, args) {
  try { return execFileSync(command, args, { encoding: "utf8" }).trim(); }
  catch { return "not available"; }
}
console.log(`Node: ${process.version}`);
console.log(`npm: ${version(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"])}`);
console.log(`Git: ${version("git", ["--version"])}`);
console.log("Local chain: Hardhat Network, chain ID 31337, loopback only");
console.log("Paid services/API keys/real cryptocurrency: not required");
