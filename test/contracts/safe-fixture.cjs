const { ethers } = require("hardhat");
const { Contract, ContractFactory, Interface, Signature, ZeroAddress, concat, getBytes, hexlify, toBeHex } = require("ethers");

const safeArtifact = require("@safe-global/safe-smart-account/build/artifacts/contracts/SafeL2.sol/SafeL2.json");
const proxyFactoryArtifact = require("@safe-global/safe-smart-account/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json");

const SAFE_TX_DEFAULTS = {
  value: 0n,
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: ZeroAddress,
  refundReceiver: ZeroAddress
};

async function deploySafeInfrastructure(deployer) {
  const singleton = await new ContractFactory(safeArtifact.abi, safeArtifact.bytecode, deployer).deploy();
  await singleton.waitForDeployment();
  const proxyFactory = await new ContractFactory(proxyFactoryArtifact.abi, proxyFactoryArtifact.bytecode, deployer).deploy();
  await proxyFactory.waitForDeployment();
  return { singleton, proxyFactory };
}

async function deploySafe(infra, owners, threshold, saltNonce, deployer) {
  const safeInterface = new Interface(safeArtifact.abi);
  const ownerAddresses = await Promise.all(owners.map((owner) => owner.getAddress()));
  const initializer = safeInterface.encodeFunctionData("setup", [
    ownerAddresses, threshold, ZeroAddress, "0x", ZeroAddress, ZeroAddress, 0, ZeroAddress
  ]);
  const tx = await infra.proxyFactory.connect(deployer).createProxyWithNonce(
    await infra.singleton.getAddress(), initializer, saltNonce
  );
  const receipt = await tx.wait();
  const parsed = receipt.logs.map((log) => {
    try { return infra.proxyFactory.interface.parseLog(log); } catch { return null; }
  }).find((event) => event && event.name === "ProxyCreation");
  if (!parsed) throw new Error("Safe ProxyCreation event missing");
  return new Contract(parsed.args.proxy, safeArtifact.abi, deployer);
}

async function signSafeHash(signer, safeHash) {
  const signature = Signature.from(await signer.signMessage(getBytes(safeHash)));
  return hexlify(concat([signature.r, signature.s, toBeHex(signature.v + 4, 1)]));
}

async function buildSafeTransaction(safe, to, data, signers) {
  const nonce = await safe.nonce();
  const args = { ...SAFE_TX_DEFAULTS, to, data, nonce };
  const safeHash = await safe.getTransactionHash(
    args.to, args.value, args.data, args.operation, args.safeTxGas,
    args.baseGas, args.gasPrice, args.gasToken, args.refundReceiver, args.nonce
  );
  const addressed = await Promise.all(signers.map(async (signer) => ({
    signer,
    address: (await signer.getAddress()).toLowerCase()
  })));
  addressed.sort((left, right) => left.address.localeCompare(right.address));
  const signatures = await Promise.all(addressed.map(({ signer }) => signSafeHash(signer, safeHash)));
  return { args, safeHash, signatures: hexlify(concat(signatures)) };
}

async function executeSafeTransaction(safe, to, data, signers, executor) {
  const transaction = await buildSafeTransaction(safe, to, data, signers);
  const response = await safe.connect(executor).execTransaction(
    transaction.args.to, transaction.args.value, transaction.args.data,
    transaction.args.operation, transaction.args.safeTxGas, transaction.args.baseGas,
    transaction.args.gasPrice, transaction.args.gasToken,
    transaction.args.refundReceiver, transaction.signatures
  );
  const receipt = await response.wait();
  const safeEvents = receipt.logs.map((log) => {
    try { return safe.interface.parseLog(log); } catch { return null; }
  }).filter(Boolean);
  return { ...transaction, response, receipt, safeEvents };
}

async function deployReferenceScenario() {
  const signers = await ethers.getSigners();
  const [deployer, depositor, A, B, C, D, E, F, outsider, executor] = signers;
  const infra = await deploySafeInfrastructure(deployer);
  const configs = [
    { id: "atlas", amount: 40_000n * 10n ** 6n, owners: [A, B, C] },
    { id: "harbor", amount: 35_000n * 10n ** 6n, owners: [A, B, D] },
    { id: "grove", amount: 25_000n * 10n ** 6n, owners: [A, B, E] }
  ];
  const safes = {};
  for (let index = 0; index < configs.length; index += 1) {
    const config = configs[index];
    safes[config.id] = await deploySafe(infra, config.owners, 2, BigInt(index + 1), deployer);
  }
  const Token = await ethers.getContractFactory("MockToken", deployer);
  const token = await Token.deploy();
  await token.waitForDeployment();
  const Vault = await ethers.getContractFactory("DemoVault", deployer);
  const vaults = {};
  for (const config of configs) {
    const vault = await Vault.deploy(await token.getAddress(), await safes[config.id].getAddress());
    await vault.waitForDeployment();
    vaults[config.id] = vault;
    await token.mint(await depositor.getAddress(), config.amount);
    await token.connect(depositor).approve(await vault.getAddress(), config.amount);
    await vault.connect(depositor).deposit(config.amount);
  }
  return {
    accounts: { deployer, depositor, A, B, C, D, E, F, outsider, executor },
    configs, infra, safes, token, vaults
  };
}

module.exports = {
  SAFE_TX_DEFAULTS, buildSafeTransaction, deployReferenceScenario,
  deploySafe, deploySafeInfrastructure, executeSafeTransaction, safeArtifact
};
