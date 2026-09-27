const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildSafeTransaction, deployReferenceScenario, executeSafeTransaction } = require("./safe-fixture.cjs");

async function expectRejected(promise) {
  let error;
  try {
    const result = await promise;
    if (result && typeof result.wait === "function") await result.wait();
  } catch (caught) { error = caught; }
  expect(error, "expected transaction to reject").to.exist;
}

describe("BREAKPOINT contract vertical slice", function () {
  it("deploys three actual Safe proxies and discovers their owner thresholds", async function () {
    const scenario = await deployReferenceScenario();
    const expected = {
      atlas: ["A", "B", "C"],
      harbor: ["A", "B", "D"],
      grove: ["A", "B", "E"]
    };
    for (const config of scenario.configs) {
      const safe = scenario.safes[config.id];
      expect(await safe.VERSION()).to.equal("1.5.0");
      expect(await safe.getThreshold()).to.equal(2n);
      const owners = (await safe.getOwners()).map((address) => address.toLowerCase());
      const expectedAddresses = await Promise.all(
        expected[config.id].map((label) => scenario.accounts[label].getAddress())
      );
      expect(new Set(owners)).to.deep.equal(new Set(expectedAddresses.map((address) => address.toLowerCase())));
      const modules = await safe.getModulesPaginated("0x0000000000000000000000000000000000000001", 10);
      expect(modules[0]).to.deep.equal([]);
      expect(await scenario.vaults[config.id].administrator()).to.equal(await safe.getAddress());
    }
  });

  it("allows baseline withdrawal, rejects direct pause, and preserves balances", async function () {
    const scenario = await deployReferenceScenario();
    const { depositor, outsider } = scenario.accounts;
    const one = 1n * 10n ** 6n;
    const vault = scenario.vaults.atlas;
    const before = await scenario.token.balanceOf(await depositor.getAddress());
    await vault.connect(depositor).withdraw(one);
    await scenario.token.connect(depositor).approve(await vault.getAddress(), one);
    await vault.connect(depositor).deposit(one);
    expect(await scenario.token.balanceOf(await depositor.getAddress())).to.equal(before);
    expect(await vault.balances(await depositor.getAddress())).to.equal(scenario.configs[0].amount);
    await expectRejected(vault.connect(outsider).pauseWithdrawals());
    expect(await vault.withdrawalsPaused()).to.equal(false);
  });

  it("executes A+B pause calls through valid Safe approvals and blocks withdrawals", async function () {
    const scenario = await deployReferenceScenario();
    const { A, B, depositor, executor } = scenario.accounts;
    for (const config of scenario.configs) {
      const safe = scenario.safes[config.id];
      const vault = scenario.vaults[config.id];
      const data = vault.interface.encodeFunctionData("pauseWithdrawals");
      const evidence = await executeSafeTransaction(safe, await vault.getAddress(), data, [A, B], executor);
      expect(evidence.receipt.status).to.equal(1);
      expect(evidence.safeEvents.some((event) => event.name === "ExecutionSuccess")).to.equal(true);
      expect(await vault.withdrawalsPaused()).to.equal(true);
      const balance = await vault.balances(await depositor.getAddress());
      await expectRejected(vault.connect(depositor).withdraw(1n));
      expect(await vault.balances(await depositor.getAddress())).to.equal(balance);
    }
  });

  it("rejects below-threshold and duplicate Safe signatures without pausing", async function () {
    const scenario = await deployReferenceScenario();
    const { A, executor } = scenario.accounts;
    const safe = scenario.safes.atlas;
    const vault = scenario.vaults.atlas;
    const data = vault.interface.encodeFunctionData("pauseWithdrawals");
    const oneSignature = await buildSafeTransaction(safe, await vault.getAddress(), data, [A]);
    const send = (signatures) => safe.connect(executor).execTransaction(
      oneSignature.args.to, oneSignature.args.value, oneSignature.args.data,
      oneSignature.args.operation, oneSignature.args.safeTxGas, oneSignature.args.baseGas,
      oneSignature.args.gasPrice, oneSignature.args.gasToken,
      oneSignature.args.refundReceiver, signatures
    );
    await expectRejected(send(oneSignature.signatures));
    const duplicated = ethers.hexlify(ethers.concat([oneSignature.signatures, oneSignature.signatures]));
    await expectRejected(send(duplicated));
    expect(await vault.withdrawalsPaused()).to.equal(false);
  });
});
