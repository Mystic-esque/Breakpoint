const { expect } = require("chai");
const fixture = require("../fixtures/reference-scenario.json");
const { analyzeCoalitions, evaluateCoalition } = require("../packages/core/dist");

const token = "0x0000000000000000000000000000000000000100";
const labels = Object.fromEntries(
  fixture.signerLabels.map((label, index) => [
    label,
    `0x${(index + 1).toString(16).padStart(40, "0")}`
  ])
);

function positions(stage) {
  return fixture.positions.map((position, index) => ({
    id: position.id,
    amountRaw: position.amountRaw,
    token,
    controller: {
      address: `0x${(index + 101).toString(16).padStart(40, "0")}`,
      owners: position[stage].map((label) => labels[label]),
      threshold: position.threshold,
      supportStatus: "supported"
    }
  }));
}

describe("exact coalition analysis", function () {
  it("computes canonical fixture results without consuming expected values as inputs", function () {
    const before = analyzeCoalitions(positions("ownersBefore"));
    const after = analyzeCoalitions(positions("ownersAfter"));
    expect(before.minimumKeysForAll).to.equal(fixture.expected.before.minimumKeysForAll);
    expect(before.maxExposureRawByKeyBudget["1"]).to.equal("0");
    expect(before.maxExposureRawByKeyBudget["2"]).to.equal(
      fixture.expected.before.maxExposureRawByKeyBudget["2"]
    );
    expect(after.minimumKeysForAll).to.equal(fixture.expected.after.minimumKeysForAll);
    for (const [budget, amount] of Object.entries(
      fixture.expected.after.maxExposureRawByKeyBudget
    )) {
      expect(after.maxExposureRawByKeyBudget[budget]).to.equal(amount);
    }
    expect(
      evaluateCoalition(positions("ownersAfter"), [labels.A, labels.B]).affectedAmountRaw
    ).to.equal("65000000000");
  });

  it("is invariant to owner casing and order", function () {
    const input = positions("ownersBefore");
    const changed = input.map((position) => ({
      ...position,
      controller: {
        ...position.controller,
        owners: [...position.controller.owners].reverse().map((address, index) =>
          index % 2 ? address.toUpperCase().replace("0X", "0x") : address
        )
      }
    }));
    expect(analyzeCoalitions(changed).maxExposureRawByKeyBudget).to.deep.equal(
      analyzeCoalitions(input).maxExposureRawByKeyBudget
    );
  });

  it("handles zero totals and rejects invalid or unsupported exact claims", function () {
    const zero = positions("ownersBefore").map((position) => ({ ...position, amountRaw: "0" }));
    expect(evaluateCoalition(zero, [labels.A]).coverageBasisPoints).to.equal(null);

    const duplicate = positions("ownersBefore");
    duplicate[0].controller.owners = [labels.A, labels.A, labels.C];
    expect(() => analyzeCoalitions(duplicate)).to.throw("Duplicate owners");

    const tooMany = Array.from({ length: 13 }, (_, index) => ({
      id: `p${index}`,
      amountRaw: "1",
      token,
      controller: {
        address: `0x${(index + 1000).toString(16).padStart(40, "0")}`,
        owners: [`0x${(index + 2000).toString(16).padStart(40, "0")}`],
        threshold: 1,
        supportStatus: "supported"
      }
    }));
    expect(() => analyzeCoalitions(tooMany)).to.throw("at most 12");

    const mixed = positions("ownersBefore");
    mixed[1].token = "0x0000000000000000000000000000000000000200";
    expect(() => analyzeCoalitions(mixed)).to.throw("Mixed-token");

    const incomplete = positions("ownersBefore");
    incomplete[0].controller.supportStatus = "incomplete";
    incomplete[0].controller.unsupportedReasons = ["module enabled"];
    const result = analyzeCoalitions(incomplete);
    expect(result.completeForSupportedModel).to.equal(false);
    expect(result.minimumKeysForAll).to.equal(null);
    expect(result.unsupportedReasons).to.deep.equal(["module enabled"]);
  });

  it("agrees with an independent exhaustive oracle on generated small inputs", function () {
    for (let seed = 1; seed <= 12; seed += 1) {
      const owners = [labels.A, labels.B, labels.C, labels.D];
      const generated = Array.from({ length: 4 }, (_, index) => {
        const rotated = owners.filter((_, ownerIndex) => ((ownerIndex + seed + index) % 3) !== 0);
        return {
          id: `g${seed}-${index}`,
          amountRaw: String(BigInt((seed + index + 1) * 137)),
          token,
          controller: {
            address: `0x${(seed * 100 + index + 3000).toString(16).padStart(40, "0")}`,
            owners: rotated,
            threshold: Math.min(2, rotated.length),
            supportStatus: "supported"
          }
        };
      });
      const actual = analyzeCoalitions(generated);
      for (let budget = 0; budget <= owners.length; budget += 1) {
        let expected = 0n;
        for (let mask = 0; mask < 2 ** owners.length; mask += 1) {
          const chosen = owners.filter((_, bit) => (mask & (1 << bit)) !== 0);
          if (chosen.length > budget) continue;
          const amount = generated.reduce((sum, position) => {
            const matches = position.controller.owners.filter((owner) => chosen.includes(owner)).length;
            return sum + (matches >= position.controller.threshold ? BigInt(position.amountRaw) : 0n);
          }, 0n);
          if (amount > expected) expected = amount;
        }
        expect(actual.maxExposureRawByKeyBudget[String(budget)]).to.equal(expected.toString());
      }
    }
  });
});
