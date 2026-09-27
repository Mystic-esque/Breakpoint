require("@nomicfoundation/hardhat-ethers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(
  async ({ solcVersion }, _hre, runSuper) => {
    if (solcVersion === "0.8.26") {
      const solc = require("solc");
      return {
        compilerPath: require.resolve("solc/soljson.js"),
        isSolcJs: true,
        version: solcVersion,
        longVersion: solc.version()
      };
    }
    return runSuper();
  }
);

module.exports = {
  solidity: { version: "0.8.26", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: { chainId: 31337, throwOnTransactionFailures: false },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 }
  },
  paths: { sources: "./contracts", tests: "./test/contracts", cache: "./cache", artifacts: "./artifacts" },
  mocha: { timeout: 120000 }
};
