import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  Contract,
  ContractFactory,
  HDNodeWallet,
  Interface,
  JsonRpcProvider,
  Signature,
  ZeroAddress,
  concat,
  getBytes,
  hexlify,
  toBeHex
} from "ethers";
import { analyzeCoalitions } from "../../core/dist";
import type { PositionInput } from "../../core/dist";
import type {
  ExecutionEvidence,
  ScenarioSnapshot,
  ScenarioStage,
  ScenarioStatus
} from "./types";

const safeArtifact = require("@safe-global/safe-smart-account/build/artifacts/contracts/SafeL2.sol/SafeL2.json");
const proxyFactoryArtifact = require("@safe-global/safe-smart-account/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json");
const tokenArtifact = require("../../../artifacts/contracts/MockToken.sol/MockToken.json");
const vaultArtifact = require("../../../artifacts/contracts/DemoVault.sol/DemoVault.json");

const RPC_URL = "http://127.0.0.1:8545";
const CHAIN_ID = 31337;
const MNEMONIC = "test test test test test test test test test test test junk";
const SENTINEL = "0x0000000000000000000000000000000000000001";
const FALLBACK_SLOT = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5";
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const ONE_TOKEN = 1_000_000n;

export type LocalPositionConfig = {
  id: "atlas" | "harbor" | "grove";
  label: string;
  amountUnits: number;
  owners: string[];
  threshold: number;
};
type Definition = Omit<LocalPositionConfig, "amountUnits"> & { amount: bigint };
const REFERENCE_DEFINITIONS: Definition[] = [
  { id: "atlas", label: "Atlas", amount: 40_000n * ONE_TOKEN, owners: ["A", "B", "C"], threshold: 2 },
  { id: "harbor", label: "Harbor", amount: 35_000n * ONE_TOKEN, owners: ["A", "B", "D"], threshold: 2 },
  { id: "grove", label: "Grove", amount: 25_000n * ONE_TOKEN, owners: ["A", "B", "E"], threshold: 2 }
];

type Deployment = {
  singleton: any;
  proxyFactory: any;
  token: any;
  safes: Record<string, any>;
  vaults: Record<string, any>;
  analysisAmounts: Record<string, string>;
};

function now() {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function storageAddress(value: string): string {
  return `0x${value.slice(-40)}`.toLowerCase();
}

export class ScenarioCoordinator {
  readonly sessionToken = randomBytes(24).toString("hex");
  private provider = new JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: 0 });
  private wallets: Record<string, HDNodeWallet>;
  private deployment: Deployment | null = null;
  private runId: string | null = null;
  private stage: ScenarioStage = "offline";
  private definitions: Definition[] = REFERENCE_DEFINITIONS.map((definition) => ({ ...definition, owners: [...definition.owners] }));
  private activeSignerLabels = ["A", "B"];
  private evidence: ExecutionEvidence[] = [];
  private operations = new Map<string, unknown>();
  private mutationActive = false;

  constructor() {
    const labels = ["deployer", "depositor", "A", "B", "C", "D", "E", "F", "outsider", "executor"];
    this.wallets = Object.fromEntries(
      labels.map((label, index) => [
        label,
        HDNodeWallet.fromPhrase(
          MNEMONIC,
          undefined,
          `m/44'/60'/0'/0/${index}`
        ).connect(this.provider)
      ])
    );
  }

  status(): ScenarioStatus {
    return {
      mode: "local-rehearsal",
      readiness: this.deployment ? "ready" : "offline",
      runId: this.runId,
      stage: this.stage,
      chainId: CHAIN_ID,
      rpcHost: "127.0.0.1"
    };
  }

  private async validateWriteBoundary() {
    const url = new URL(RPC_URL);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new Error("Write RPC must be loopback");
    }
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) {
      throw new Error(`Refusing write on chain ${network.chainId.toString()}`);
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.mutationActive) throw new Error("Another scenario mutation is in progress");
    this.mutationActive = true;
    try {
      return await operation();
    } finally {
      this.mutationActive = false;
    }
  }

  private record(event: Omit<ExecutionEvidence, "recordedAt" | "chainId" | "runId">) {
    if (!this.runId) throw new Error("No active run");
    this.evidence.push({
      ...event,
      runId: this.runId,
      chainId: CHAIN_ID,
      recordedAt: now()
    });
  }

  private async deploySafe(
    singleton: any,
    proxyFactory: any,
    ownerLabels: readonly string[],
    threshold: number,
    salt: bigint
  ) {
    const owners = ownerLabels.map((label) => this.wallets[label].address);
    const iface = new Interface(safeArtifact.abi);
    const initializer = iface.encodeFunctionData("setup", [
      owners, threshold, ZeroAddress, "0x", ZeroAddress, ZeroAddress, 0, ZeroAddress
    ]);
    const tx = await proxyFactory.createProxyWithNonce(
      await singleton.getAddress(),
      initializer,
      salt
    );
    const receipt = await tx.wait();
    const created = receipt.logs.map((log: any) => {
      try { return proxyFactory.interface.parseLog(log); } catch { return null; }
    }).find((event: any) => event?.name === "ProxyCreation");
    if (!created) throw new Error("Safe ProxyCreation event missing");
    return new Contract(created.args.proxy, safeArtifact.abi, this.wallets.deployer);
  }

  async start(operationId: string = randomUUID()) {
    if (this.deployment) return {
      status: this.status(),
      snapshot: await this.snapshot(),
      evidence: this.evidenceForCurrentRun()
    };
    return this.exclusive(async () => {
      await this.validateWriteBoundary();
      this.runId = randomUUID();
      this.activeSignerLabels = ["A", "B"];
      const deployer = this.wallets.deployer;
      const singleton: any = await new ContractFactory(safeArtifact.abi, safeArtifact.bytecode, deployer).deploy();
      await singleton.waitForDeployment();
      const proxyFactory: any = await new ContractFactory(
        proxyFactoryArtifact.abi,
        proxyFactoryArtifact.bytecode,
        deployer
      ).deploy();
      await proxyFactory.waitForDeployment();

      const safes: Record<string, Contract> = {};
      for (let index = 0; index < this.definitions.length; index += 1) {
        const definition = this.definitions[index];
        safes[definition.id] = await this.deploySafe(
          singleton,
          proxyFactory,
          definition.owners,
          definition.threshold,
          BigInt(index + 1)
        );
      }

      const token: any = await new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer).deploy();
      await token.waitForDeployment();
      const vaults: Record<string, Contract> = {};
      for (const definition of this.definitions) {
        const vault: any = await new ContractFactory(
          vaultArtifact.abi,
          vaultArtifact.bytecode,
          deployer
        ).deploy(await token.getAddress(), await safes[definition.id].getAddress());
        await vault.waitForDeployment();
        vaults[definition.id] = vault;
        await (await token.mint(this.wallets.depositor.address, definition.amount)).wait();
        await (await (token.connect(this.wallets.depositor) as any).approve(
          await vault.getAddress(), definition.amount
        )).wait();
        await (await (vault.connect(this.wallets.depositor) as any).deposit(definition.amount)).wait();
      }
      const analysisAmounts = Object.fromEntries(
        await Promise.all(this.definitions.map(async (definition) => [
          definition.id,
          (await vaults[definition.id].balances(this.wallets.depositor.address)).toString()
        ]))
      );
      this.deployment = { singleton, proxyFactory, token, safes, vaults, analysisAmounts };
      this.stage = "ready";
      const block = await this.provider.getBlock("latest");
      this.record({
        operationId,
        kind: "deploy",
        method: "deploy SafeL2 proxies + fixture vaults",
        blockNumber: block?.number.toString(),
        outerStatus: "success",
        safeExecutionStatus: "not-applicable",
        expectedOutcome: "Three funded vaults controlled by actual configured Safe proxies",
        observedOutcome: "Deployment and deposits confirmed"
      });
      await this.baselineProbe(`${operationId}:baseline`);
      return {
        status: this.status(),
        snapshot: await this.snapshot(),
        evidence: this.evidenceForCurrentRun()
      };
    });
  }

  private async baselineProbe(operationId: string) {
    if (!this.deployment) throw new Error("Scenario is not started");
    const checkpoint = await this.provider.send("evm_snapshot", []);
    try {
      for (const definition of this.definitions) {
        const vault = this.deployment.vaults[definition.id];
        const tx = await (vault.connect(this.wallets.depositor) as any).withdraw(ONE_TOKEN);
        const receipt = await tx.wait();
        this.record({
          operationId,
          kind: "baseline",
          positionId: definition.id,
          destination: await vault.getAddress(),
          method: "withdraw(1 DemoUSD) on disposable branch",
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber.toString(),
          outerStatus: "success",
          safeExecutionStatus: "not-applicable",
          expectedOutcome: "Withdrawal succeeds before pause",
          observedOutcome: "Withdrawal succeeded; branch restored"
        });
      }
    } finally {
      await this.provider.send("evm_revert", [checkpoint]);
    }
  }

  async reset(expectedRunId: string | null, operationId: string) {
    if (this.operations.has(operationId)) return this.operations.get(operationId);
    await this.exclusive(async () => {
      if (expectedRunId && this.runId && expectedRunId !== this.runId) {
        throw new Error("Stale run id");
      }
      await this.validateWriteBoundary();
      await this.provider.send("hardhat_reset", []);
      this.deployment = null;
      this.stage = "offline";
    });
    const result = await this.start(`${operationId}:deploy`);
    this.operations.set(operationId, result);
    return result;
  }

  async createScenario(expectedRunId: string, input: LocalPositionConfig[], operationId: string) {
    if (this.operations.has(operationId)) return this.operations.get(operationId);
    if (!Array.isArray(input) || input.length !== 3) throw new Error("Configure exactly three local vaults");
    const expectedIds = ["atlas", "harbor", "grove"];
    const definitions: Definition[] = input.map((item, index) => {
      if (item.id !== expectedIds[index] || typeof item.label !== "string" ||
          !/^[a-zA-Z0-9 -]{1,24}$/.test(item.label.trim())) {
        throw new Error("Invalid local vault name or order");
      }
      if (!Number.isSafeInteger(item.amountUnits) || item.amountUnits < 1 || item.amountUnits > 1_000_000) {
        throw new Error("Each demo allocation must be 1 to 1,000,000 whole units");
      }
      if (!Array.isArray(item.owners) || item.owners.length !== 3 ||
          new Set(item.owners).size !== 3 ||
          item.owners.some((label) => !["A", "B", "C", "D", "E", "F"].includes(label))) {
        throw new Error("Each Safe needs three distinct local fixture owners");
      }
      if (!Number.isInteger(item.threshold) || item.threshold < 1 || item.threshold > 3) {
        throw new Error("Safe threshold must be one, two, or three");
      }
      return { id: item.id, label: item.label.trim(), amount: BigInt(item.amountUnits) * ONE_TOKEN,
        owners: [...item.owners], threshold: item.threshold };
    });
    await this.exclusive(async () => {
      if (this.runId !== expectedRunId) throw new Error("Stale run id");
      await this.validateWriteBoundary();
      await this.provider.send("hardhat_reset", []);
      this.deployment = null;
      this.stage = "offline";
      this.definitions = definitions;
    });
    const result = await this.start(`${operationId}:deploy`);
    this.operations.set(operationId, result);
    return result;
  }

  async snapshot(): Promise<ScenarioSnapshot> {
    if (!this.deployment || !this.runId) throw new Error("Scenario is not started");
    const rawBlock = await this.provider.send("eth_getBlockByNumber", ["latest", false]);
    if (!rawBlock?.hash || !rawBlock?.number) throw new Error("Latest block unavailable");
    const blockTag = Number(BigInt(rawBlock.number));
    const ownerLabels = Object.fromEntries(
      ["A", "B", "C", "D", "E", "F"].map((label) => [
        this.wallets[label].address.toLowerCase(),
        label
      ])
    );
    const positions: ScenarioSnapshot["positions"] = [];

    for (const definition of this.definitions) {
      const safe = this.deployment.safes[definition.id];
      const vault = this.deployment.vaults[definition.id];
      const [ownersRaw, thresholdRaw, version, modulesPage, fallbackRaw, guardRaw, paused, amountRaw] =
        await Promise.all([
          safe.getOwners({ blockTag }),
          safe.getThreshold({ blockTag }),
          safe.VERSION({ blockTag }),
          safe.getModulesPaginated(SENTINEL, 10, { blockTag }),
          safe.getStorageAt(BigInt(FALLBACK_SLOT), 1, { blockTag }),
          safe.getStorageAt(BigInt(GUARD_SLOT), 1, { blockTag }),
          vault.withdrawalsPaused({ blockTag }),
          vault.balances(this.wallets.depositor.address, { blockTag })
        ]);
      const owners = (ownersRaw as string[]).map((address) => address.toLowerCase());
      const ownerCodes = await Promise.all(
        owners.map((address) => this.provider.getCode(address, blockTag))
      );
      const reasons: string[] = [];
      if (version !== "1.5.0") reasons.push(`Unsupported Safe version ${version}`);
      if ((modulesPage[0] as string[]).length > 0) reasons.push("Safe module enabled");
      if (storageAddress(fallbackRaw) !== ZeroAddress.toLowerCase()) {
        reasons.push("Fallback handler enabled");
      }
      if (storageAddress(guardRaw) !== ZeroAddress.toLowerCase()) {
        reasons.push("Guard enabled");
      }
      if (ownerCodes.some((code) => code !== "0x")) reasons.push("Contract owner present");

      const controller = {
        address: (await safe.getAddress()).toLowerCase(),
        owners,
        threshold: Number(thresholdRaw),
        supportStatus: reasons.length ? "incomplete" as const : "supported" as const,
        unsupportedReasons: reasons
      };
      const position: PositionInput = {
        id: definition.id,
        amountRaw: this.deployment.analysisAmounts[definition.id],
        token: (await this.deployment.token.getAddress()).toLowerCase(),
        controller
      };
      positions.push({
        ...position,
        label: definition.label,
        vaultAddress: (await vault.getAddress()).toLowerCase(),
        depositor: this.wallets.depositor.address.toLowerCase(),
        withdrawalsPaused: Boolean(paused),
        currentAmountRaw: amountRaw.toString(),
        ownerLabels
      });
    }

    return {
      schemaVersion: 1,
      runId: this.runId,
      chainId: CHAIN_ID,
      blockNumber: blockTag.toString(),
      blockHash: rawBlock.hash,
      observedAt: now(),
      token: {
        address: (await this.deployment.token.getAddress()).toLowerCase(),
        name: await this.deployment.token.name({ blockTag }),
        symbol: await this.deployment.token.symbol({ blockTag }),
        decimals: Number(await this.deployment.token.decimals({ blockTag })),
        hasMonetaryValue: false
      },
      positions,
      analysis: analyzeCoalitions(positions),
      selectedCoalition: this.activeSignerLabels.map((label) => this.wallets[label].address.toLowerCase())
    };
  }

  private async signSafeHash(label: string, safeHash: string) {
    const signature = Signature.from(
      await this.wallets[label].signMessage(getBytes(safeHash))
    );
    return hexlify(concat([
      signature.r,
      signature.s,
      toBeHex(signature.v + 4, 1)
    ]));
  }

  private async safeCall(
    safe: Contract,
    destination: string,
    data: string,
    signerLabels: string[]
  ) {
    const nonce = await safe.nonce();
    const values = {
      to: destination,
      value: 0n,
      data,
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZeroAddress,
      refundReceiver: ZeroAddress,
      nonce
    };
    const safeHash = await safe.getTransactionHash(
      values.to, values.value, values.data, values.operation, values.safeTxGas,
      values.baseGas, values.gasPrice, values.gasToken, values.refundReceiver,
      values.nonce
    );
    const owners = new Set(((await safe.getOwners()) as string[]).map((address) => address.toLowerCase()));
    const threshold = Number(await safe.getThreshold());
    const sorted = signerLabels
      .filter((label) => owners.has(this.wallets[label].address.toLowerCase()))
      .map((label) => ({ label, address: this.wallets[label].address.toLowerCase() }))
      .sort((left, right) => left.address.localeCompare(right.address))
      .slice(0, threshold);
    const signatures = hexlify(concat(await Promise.all(
      sorted.map(({ label }) => this.signSafeHash(label, safeHash))
    )));
    const response = await (safe.connect(this.wallets.executor) as any).execTransaction(
      values.to, values.value, values.data, values.operation, values.safeTxGas,
      values.baseGas, values.gasPrice, values.gasToken, values.refundReceiver,
      signatures,
      { gasLimit: 6_000_000 }
    );
    const receipt = await response.wait();
    const events = receipt.logs.map((log: any) => {
      try { return safe.interface.parseLog(log); } catch { return null; }
    }).filter(Boolean);
    const successful = events.some((event: any) => event.name === "ExecutionSuccess");
    return { receipt, safeHash, successful, events };
  }

  async rehearse(
    expectedRunId: string,
    snapshotBlockHash: string,
    signerLabels: string[],
    positionIds: string[],
    operationId: string
  ) {
    if (this.operations.has(operationId)) return this.operations.get(operationId);
    const result = await this.exclusive(async () => {
      if (!this.deployment || !this.runId) throw new Error("Scenario is not started");
      if (expectedRunId !== this.runId) throw new Error("Stale run id");
      const before = await this.snapshot();
      if (before.blockHash !== snapshotBlockHash) throw new Error("Stale snapshot");
      if (!Array.isArray(signerLabels) || signerLabels.length === 0 ||
          new Set(signerLabels).size !== signerLabels.length ||
          signerLabels.some((label) => !["A", "B", "C", "D", "E", "F"].includes(label))) {
        throw new Error("Unknown fixture signer");
      }
      if (!Array.isArray(positionIds) || positionIds.length === 0 ||
          new Set(positionIds).size !== positionIds.length ||
          positionIds.some((id) => !this.definitions.some((definition) => definition.id === id))) {
        throw new Error("Choose one or more distinct fixture positions");
      }
      if (this.stage !== "ready" && this.stage !== "patched") {
        throw new Error("Rehearsal requires a clean baseline or an applied change");
      }
      await this.validateWriteBoundary();
      this.activeSignerLabels = [...signerLabels];

      for (const definition of this.definitions.filter((item) => positionIds.includes(item.id))) {
        const safe = this.deployment.safes[definition.id];
        const vault = this.deployment.vaults[definition.id];
        const safeOwners = new Set(((await safe.getOwners()) as string[]).map((address) => address.toLowerCase()));
        const signingSignerLabels = signerLabels
          .filter((label) => safeOwners.has(this.wallets[label].address.toLowerCase()))
          .sort((left, right) => this.wallets[left].address.toLowerCase().localeCompare(this.wallets[right].address.toLowerCase()))
          .slice(0, Number(await safe.getThreshold()));
        const pausedBefore = await vault.withdrawalsPaused();
        try {
          const execution = await this.safeCall(
            safe,
            await vault.getAddress(),
            vault.interface.encodeFunctionData("pauseWithdrawals"),
            signerLabels
          );
          const pausedAfter = await vault.withdrawalsPaused();
          this.record({
            operationId,
            kind: "pause",
            positionId: definition.id,
            requestedSignerLabels: [...signerLabels], signingSignerLabels,
            destination: await vault.getAddress(),
            method: "Safe.execTransaction -> pauseWithdrawals()",
            txHash: execution.receipt.hash,
            blockNumber: execution.receipt.blockNumber.toString(),
            outerStatus: execution.receipt.status === 1 ? "success" : "reverted",
            safeExecutionStatus: execution.successful ? "success" : "failure",
            before: { withdrawalsPaused: pausedBefore },
            after: { withdrawalsPaused: pausedAfter },
            expectedOutcome: "Authorization result follows current Safe owner threshold",
            observedOutcome: execution.successful && pausedAfter
              ? "Safe execution accepted; withdrawals paused"
              : "Safe execution did not pause withdrawals"
          });
        } catch (error: any) {
          const receipt = error?.receipt;
          const pausedAfter = await vault.withdrawalsPaused();
          this.record({
            operationId,
            kind: "pause",
            positionId: definition.id,
            requestedSignerLabels: [...signerLabels], signingSignerLabels,
            destination: await vault.getAddress(),
            method: "Safe.execTransaction -> pauseWithdrawals()",
            txHash: receipt?.hash ?? error?.transactionHash,
            blockNumber: receipt?.blockNumber?.toString(),
            outerStatus: receipt ? "reverted" : "not-broadcast",
            safeExecutionStatus: "failure",
            before: { withdrawalsPaused: pausedBefore },
            after: { withdrawalsPaused: pausedAfter },
            expectedOutcome: "Authorization result follows current Safe owner threshold",
            observedOutcome: "Safe authorization rejected; withdrawals remain available",
            error: errorMessage(error)
          });
        }
      }

      if (this.stage === "patched") {
        for (const definition of this.definitions.filter((item) => positionIds.includes(item.id))) {
          const vault = this.deployment.vaults[definition.id];
          if (await vault.withdrawalsPaused()) continue;
          const beforeBalance = await vault.balances(this.wallets.depositor.address);
          const tx = await (vault.connect(this.wallets.depositor) as any).withdraw(ONE_TOKEN);
          const receipt = await tx.wait();
          const afterBalance = await vault.balances(this.wallets.depositor.address);
          this.record({
            operationId,
            kind: "withdrawal-probe",
            positionId: definition.id,
            destination: await vault.getAddress(),
            method: "withdraw(1 DemoUSD)",
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber.toString(),
            outerStatus: "success",
            safeExecutionStatus: "not-applicable",
            before: { depositorBalanceRaw: beforeBalance.toString() },
            after: { depositorBalanceRaw: afterBalance.toString() },
            expectedOutcome: "Vault remains withdrawable after rejected authorization",
            observedOutcome: "Withdrawal succeeded"
          });
        }
        this.stage = "replayed";
      } else {
        this.stage = "paused";
      }

      return {
        status: this.status(),
        snapshot: await this.snapshot(),
        evidence: this.evidenceForCurrentRun()
      };
    });
    this.operations.set(operationId, result);
    return result;
  }

  private previousOwner(owners: string[], target: string): string {
    const index = owners.findIndex(
      (owner) => owner.toLowerCase() === target.toLowerCase()
    );
    if (index < 0) throw new Error("Owner to replace not found");
    return index === 0 ? SENTINEL : owners[index - 1];
  }

  async applyConfiguration(
    expectedRunId: string,
    snapshotBlockHash: string,
    positionId: string,
    ownerLabels: string[],
    threshold: number,
    operationId: string
  ) {
    if (this.operations.has(operationId)) return this.operations.get(operationId);
    const result = await this.exclusive(async () => {
      if (!this.deployment || !this.runId) throw new Error("Scenario is not started");
      if (expectedRunId !== this.runId) throw new Error("Stale run id");
      if (this.stage !== "ready") throw new Error("Configuration change requires a clean baseline; reset first");
      if (!this.definitions.some((definition) => definition.id === positionId)) {
        throw new Error("Unknown fixture position");
      }
      if (!Array.isArray(ownerLabels) || ownerLabels.length !== 3 ||
          new Set(ownerLabels).size !== 3 ||
          ownerLabels.some((label) => !["A", "B", "C", "D", "E", "F"].includes(label))) {
        throw new Error("Choose three distinct local fixture signers");
      }
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > 3) {
        throw new Error("Threshold must be between one and three");
      }
      const before = await this.snapshot();
      if (before.blockHash !== snapshotBlockHash) throw new Error("Stale snapshot");
      await this.validateWriteBoundary();
      const safe = this.deployment.safes[positionId];
      const target = new Set(ownerLabels);
      const currentLabels = () => before.positions[0].ownerLabels;
      const initial = ((await safe.getOwners()) as string[]).map((address) => currentLabels()[address.toLowerCase()]);
      if (initial.every((label) => target.has(label)) && Number(await safe.getThreshold()) === threshold) {
        throw new Error("Proposed configuration is identical to the current one");
      }
      const removed = initial.filter((label) => !target.has(label));
      const added = ownerLabels.filter((label) => !initial.includes(label));
      for (let index = 0; index < removed.length; index += 1) {
        const beforeOwners = (await safe.getOwners()) as string[];
        const approvals = beforeOwners
          .map((address) => currentLabels()[address.toLowerCase()])
          .slice(0, Number(await safe.getThreshold()));
        const data = safe.interface.encodeFunctionData("swapOwner", [
          this.previousOwner(beforeOwners, this.wallets[removed[index]].address),
          this.wallets[removed[index]].address,
          this.wallets[added[index]].address
        ]);
        const execution = await this.safeCall(safe, await safe.getAddress(), data, approvals);
        if (!execution.successful) throw new Error("Safe owner change failed");
        const afterOwners = (await safe.getOwners()) as string[];
        this.record({
          operationId, kind: "owner-change", positionId,
          destination: await safe.getAddress(),
          method: `Safe.execTransaction -> swapOwner(${removed[index]}, ${added[index]})`,
          txHash: execution.receipt.hash,
          blockNumber: execution.receipt.blockNumber.toString(),
          outerStatus: "success", safeExecutionStatus: "success",
          before: { owners: beforeOwners.map((owner) => owner.toLowerCase()) },
          after: { owners: afterOwners.map((owner) => owner.toLowerCase()) },
          expectedOutcome: `Replace ${positionId} signer ${removed[index]} with ${added[index]}`,
          observedOutcome: "Owner set changed onchain"
        });
      }
      const oldThreshold = Number(await safe.getThreshold());
      if (oldThreshold !== threshold) {
        const currentOwners = (await safe.getOwners()) as string[];
        const approvals = currentOwners
          .map((address) => currentLabels()[address.toLowerCase()])
          .slice(0, oldThreshold);
        const data = safe.interface.encodeFunctionData("changeThreshold", [threshold]);
        const execution = await this.safeCall(safe, await safe.getAddress(), data, approvals);
        if (!execution.successful) throw new Error("Safe threshold change failed");
        this.record({
          operationId, kind: "threshold-change", positionId,
          destination: await safe.getAddress(),
          method: `Safe.execTransaction -> changeThreshold(${threshold})`,
          txHash: execution.receipt.hash,
          blockNumber: execution.receipt.blockNumber.toString(),
          outerStatus: "success", safeExecutionStatus: "success",
          before: { threshold: oldThreshold }, after: { threshold },
          expectedOutcome: `Set ${positionId} Safe threshold to ${threshold}`,
          observedOutcome: "Threshold changed onchain"
        });
      }
      const verified = await this.snapshot();
      const configured = verified.positions.find((position) => position.id === positionId)!;
      if (configured.controller.threshold !== threshold ||
          configured.controller.owners.length !== 3 ||
          configured.controller.owners.some((address) => !target.has(configured.ownerLabels[address]))) {
        throw new Error("Configuration verification failed");
      }
      this.stage = "patched";
      return { status: this.status(), snapshot: verified, evidence: this.evidenceForCurrentRun() };
    });
    this.operations.set(operationId, result);
    return result;
  }

  async patchHarbor(expectedRunId: string, operationId: string) {
    if (this.operations.has(operationId)) return this.operations.get(operationId);
    const result = await this.exclusive(async () => {
      if (!this.deployment || !this.runId) throw new Error("Scenario is not started");
      if (expectedRunId !== this.runId) throw new Error("Stale run id");
      if (this.stage !== "ready") {
        throw new Error("Harbor patch requires a clean baseline; reset first");
      }
      await this.validateWriteBoundary();
      const safe = this.deployment.safes.harbor;
      const changes = [
        { oldLabel: "A", newLabel: "C", approvals: ["A", "B"] },
        { oldLabel: "B", newLabel: "F", approvals: ["B", "D"] }
      ];
      for (const change of changes) {
        const beforeOwners = (await safe.getOwners()) as string[];
        const oldOwner = this.wallets[change.oldLabel].address;
        const newOwner = this.wallets[change.newLabel].address;
        const previous = this.previousOwner(beforeOwners, oldOwner);
        const data = safe.interface.encodeFunctionData("swapOwner", [
          previous,
          oldOwner,
          newOwner
        ]);
        const execution = await this.safeCall(
          safe,
          await safe.getAddress(),
          data,
          change.approvals
        );
        const afterOwners = (await safe.getOwners()) as string[];
        if (!execution.successful) throw new Error("Safe owner change failed");
        this.record({
          operationId,
          kind: "owner-change",
          positionId: "harbor",
          destination: await safe.getAddress(),
          method: `Safe.execTransaction -> swapOwner(${change.oldLabel}, ${change.newLabel})`,
          txHash: execution.receipt.hash,
          blockNumber: execution.receipt.blockNumber.toString(),
          outerStatus: "success",
          safeExecutionStatus: "success",
          before: { owners: beforeOwners.map((owner) => owner.toLowerCase()) },
          after: { owners: afterOwners.map((owner) => owner.toLowerCase()) },
          expectedOutcome: `Replace Harbor signer ${change.oldLabel} with ${change.newLabel}`,
          observedOutcome: "Owner set changed onchain"
        });
      }
      const finalOwners = new Set(
        ((await safe.getOwners()) as string[]).map((owner) => owner.toLowerCase())
      );
      const expected = ["C", "D", "F"].map(
        (label) => this.wallets[label].address.toLowerCase()
      );
      if (expected.some((owner) => !finalOwners.has(owner)) || finalOwners.size !== 3) {
        throw new Error("Harbor owner verification failed");
      }
      if (await safe.getThreshold() !== 2n) {
        throw new Error("Harbor threshold changed unexpectedly");
      }
      this.stage = "patched";
      return {
        status: this.status(),
        snapshot: await this.snapshot(),
        evidence: this.evidenceForCurrentRun()
      };
    });
    this.operations.set(operationId, result);
    return result;
  }

  evidenceForCurrentRun() {
    return this.evidence.filter((event) => event.runId === this.runId);
  }

  async exportBundle(expectedRunId?: string, expectedBlockHash?: string) {
    const snapshot = await this.snapshot();
    if (expectedRunId && snapshot.runId !== expectedRunId) throw new Error("Stale run id");
    if (expectedBlockHash && snapshot.blockHash !== expectedBlockHash) throw new Error("Stale snapshot");
    if (this.mutationActive) throw new Error("Operation in progress; export after confirmation");
    const evidence = this.evidenceForCurrentRun();
    const confirmed = await this.snapshot();
    if (confirmed.runId !== snapshot.runId || confirmed.blockHash !== snapshot.blockHash) {
      throw new Error("Snapshot changed during export");
    }
    const bundle = {
      schemaVersion: 1,
      kind: "breakpoint-local-evidence",
      generatedAt: now(),
      mode: "local-rehearsal",
      snapshot,
      evidence,
      assumptions: [
        "Known Safe 1.5.0 proxies with EOA owners, threshold authorization, no modules, guards, or fallback handlers",
        "Authority to pause withdrawals is not evidence of malicious intent or key compromise",
        "DemoUSD is a valueless local fixture token"
      ],
      limitations: [
        "Not a production audit",
        "No compromise probabilities or identity claims",
        "No hidden upgrade, source-level backdoor, liquidity, or market-loss analysis"
      ]
    };
    const canonical = JSON.stringify(bundle, null, 2);
    const sha256 = createHash("sha256").update(canonical).digest("hex");
    const markdown = [
      "# BREAKPOINT evidence",
      "",
      `Run: ${snapshot.runId}`,
      `Chain: local ${snapshot.chainId}`,
      `Snapshot: block ${snapshot.blockNumber} (${snapshot.blockHash})`,
      `Stage: ${this.stage}`,
      `SHA-256 of JSON payload: ${sha256}`,
      "",
      "## Measured result",
      "",
      `Total selected: ${snapshot.analysis.totalSelectedAmountRaw} raw DemoUSD units`,
      `Maximum two-key exposure: ${snapshot.analysis.maxExposureRawByKeyBudget["2"] ?? "n/a"} raw units`,
      `Minimum keys for all supported positions: ${snapshot.analysis.minimumKeysForAll ?? "not established"}`,
      "",
      "## Evidence events",
      "",
      ...bundle.evidence.map((event, index) =>
        `${index + 1}. ${event.kind} ${event.positionId ?? ""} -- ${event.observedOutcome}${event.txHash ? ` (${event.txHash})` : ""}`
      ),
      "",
      "This report records a local rehearsal. It is not a certification of safety."
    ].join("\n");
    return { json: canonical, markdown, sha256 };
  }
}

export const scenarioCoordinator = new ScenarioCoordinator();
export * from "./types";
