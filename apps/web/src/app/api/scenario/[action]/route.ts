import { NextRequest, NextResponse } from "next/server";
import { scenarioCoordinator as importedCoordinator } from "@breakpoint/scenario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const globalScenario = globalThis as typeof globalThis & {
  breakpointCoordinator?: typeof importedCoordinator;
};
const coordinator = globalScenario.breakpointCoordinator ?? importedCoordinator;
globalScenario.breakpointCoordinator = coordinator;

function guardLocal(request: NextRequest, requireToken: boolean) {
  const host = request.headers.get("host") ?? "";
  const hostname = host.replace(/^\[/, "").split(/\]:|:/)[0];
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("Unexpected Host header");
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== host) {
    throw new Error("Cross-origin request rejected");
  }
  if (
    requireToken &&
    request.headers.get("x-breakpoint-session") !== coordinator.sessionToken
  ) {
    throw new Error("Invalid local session token");
  }
}

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /token|origin|Host/.test(message) ? 403 : /stale|progress|baseline/.test(message) ? 409 : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ action: string }> }
) {
  try {
    guardLocal(request, false);
    const { action } = await context.params;
    if (action === "status") return NextResponse.json(coordinator.status());
    if (action === "snapshot") return NextResponse.json(await coordinator.snapshot());
    if (action === "evidence") return NextResponse.json(coordinator.evidenceForCurrentRun());
    if (action === "export") return NextResponse.json(await coordinator.exportBundle());
    return NextResponse.json({ error: "Unknown scenario route" }, { status: 404 });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> }
) {
  try {
    const { action } = await context.params;
    guardLocal(request, action !== "start");
    const body = await request.json().catch(() => ({}));
    if (action === "start") {
      const result = await coordinator.start(body.operationId);
      return NextResponse.json({ ...result, sessionToken: coordinator.sessionToken });
    }
    if (action === "reset") {
      return NextResponse.json(
        await coordinator.reset(body.expectedRunId ?? null, body.operationId)
      );
    }
    if (action === "create-scenario") {
      return NextResponse.json(await coordinator.createScenario(
        body.expectedRunId, body.positions, body.operationId
      ));
    }
    if (action === "patch-harbor") {
      return NextResponse.json(
        await coordinator.patchHarbor(body.expectedRunId, body.operationId)
      );
    }
    if (action === "apply-configuration") {
      return NextResponse.json(await coordinator.applyConfiguration(
        body.expectedRunId, body.snapshotBlockHash, body.positionId,
        body.ownerLabels, body.threshold, body.operationId
      ));
    }
    if (action === "rehearse") {
      return NextResponse.json(
        await coordinator.rehearse(
          body.expectedRunId,
          body.snapshotBlockHash,
          body.signerLabels,
          body.positionIds,
          body.operationId
        )
      );
    }
    if (action === "export") {
      return NextResponse.json(await coordinator.exportBundle(body.expectedRunId, body.snapshotBlockHash));
    }
    return NextResponse.json({ error: "Unknown scenario route" }, { status: 404 });
  } catch (error) {
    return responseError(error);
  }
}
