import { describe, expect, it } from "vitest";
import {
  RemoteSimulationError,
  SimulationCancelledError,
  SimulationWorkerClient,
  SimulationWorkerProtocolError,
  type SimulationWorkerHandlers,
  type SimulationWorkerPort,
} from "./simulationWorkerClient";
import {
  runSimulation,
  type PortfolioAssumptions,
} from "./simulation";
import type {
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./simulationWorkerProtocol";

const ASSUMPTIONS: PortfolioAssumptions = {
  startingBalance: 5_000,
  monthlyContribution: 100,
  years: 1,
  annualReturn: 0.05,
  annualVolatility: 0.1,
  annualInflation: 0.02,
  annualFee: 0.001,
  targetTodayValue: 7_000,
  targetSuccessBps: 8_000,
};

const OPTIONS = { scenarios: 10, seed: 9 };

class FakeWorkerPort implements SimulationWorkerPort {
  handlers: SimulationWorkerHandlers | null = null;
  posted: SimulationWorkerRequest[] = [];
  terminateCount = 0;

  setHandlers(handlers: SimulationWorkerHandlers): void {
    this.handlers = handlers;
  }

  postMessage(message: SimulationWorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminateCount += 1;
  }

  emit(response: SimulationWorkerResponse | unknown): void {
    this.handlers?.onMessage(response);
  }

  fail(error: unknown): void {
    this.handlers?.onError(error);
  }
}

function setupClient() {
  const ports: FakeWorkerPort[] = [];
  const client = new SimulationWorkerClient(() => {
    const port = new FakeWorkerPort();
    ports.push(port);
    return port;
  });
  return { client, ports };
}

function completedResponse(
  requestId: number,
  assumptions = ASSUMPTIONS,
  options = OPTIONS,
): SimulationWorkerResponse {
  return {
    type: "completed",
    requestId,
    result: runSimulation(assumptions, options),
  };
}

describe("SimulationWorkerClient", () => {
  it("posts an exact run snapshot, resolves it, and terminates the worker", async () => {
    const { client, ports } = setupClient();
    const resultPromise = client.run(ASSUMPTIONS, OPTIONS);
    const port = ports[0];

    expect(port).toBeDefined();
    expect(port?.posted).toEqual([
      {
        type: "run",
        requestId: 1,
        assumptions: ASSUMPTIONS,
        options: OPTIONS,
      },
    ]);

    const response = completedResponse(1);
    port?.emit(response);

    await expect(resultPromise).resolves.toEqual(
      response.type === "completed" ? response.result : undefined,
    );
    expect(port?.terminateCount).toBe(1);
    expect(client.activeRequestId).toBeNull();
  });

  it("cancels a superseded run and ignores its late response", async () => {
    const { client, ports } = setupClient();
    const firstPromise = client.run(ASSUMPTIONS, OPTIONS);
    const firstError = firstPromise.catch((error: unknown) => error);
    const secondOptions = { ...OPTIONS, seed: 10 };
    const secondPromise = client.run(ASSUMPTIONS, secondOptions);
    const firstPort = ports[0];
    const secondPort = ports[1];

    expect(await firstError).toBeInstanceOf(SimulationCancelledError);
    expect(firstPort?.terminateCount).toBe(1);

    firstPort?.emit(completedResponse(1));
    secondPort?.emit(completedResponse(2, ASSUMPTIONS, secondOptions));

    await expect(secondPromise).resolves.toMatchObject({ seed: 10 });
    expect(secondPort?.terminateCount).toBe(1);
  });

  it("supports explicit cancellation and settles the promise", async () => {
    const { client, ports } = setupClient();
    const resultPromise = client.run(ASSUMPTIONS, OPTIONS);
    const rejection = resultPromise.catch((error: unknown) => error);

    expect(client.cancel()).toBe(true);
    expect(await rejection).toBeInstanceOf(SimulationCancelledError);
    expect(ports[0]?.terminateCount).toBe(1);
    expect(client.cancel()).toBe(false);
  });

  it("turns a serialized failure into a typed remote error", async () => {
    const { client, ports } = setupClient();
    const resultPromise = client.run(ASSUMPTIONS, OPTIONS);
    const rejection = resultPromise.catch((error: unknown) => error);

    ports[0]?.emit({
      type: "failed",
      requestId: 1,
      error: {
        name: "SimulationValidationError",
        message: "Invalid assumptions.",
        issues: [{ field: "years", message: "Invalid horizon." }],
      },
    });

    const error = await rejection;
    expect(error).toBeInstanceOf(RemoteSimulationError);
    expect(error).toMatchObject({
      name: "SimulationValidationError",
      remoteName: "SimulationValidationError",
      issues: [{ field: "years", message: "Invalid horizon." }],
    });
    expect(ports[0]?.terminateCount).toBe(1);
  });

  it("rejects malformed responses and worker failures", async () => {
    const { client, ports } = setupClient();
    const malformedPromise = client.run(ASSUMPTIONS, OPTIONS);
    const malformedError = malformedPromise.catch((error: unknown) => error);
    ports[0]?.emit({ type: "completed", requestId: 1 });

    expect(await malformedError).toBeInstanceOf(SimulationWorkerProtocolError);
    expect(ports[0]?.terminateCount).toBe(1);

    const malformedResultPromise = client.run(ASSUMPTIONS, OPTIONS);
    const malformedResultError = malformedResultPromise.catch(
      (error: unknown) => error,
    );
    ports[1]?.emit({ type: "completed", requestId: 2, result: {} });

    expect(await malformedResultError).toBeInstanceOf(
      SimulationWorkerProtocolError,
    );
    expect(ports[1]?.terminateCount).toBe(1);

    const failedPromise = client.run(ASSUMPTIONS, OPTIONS);
    const workerError = failedPromise.catch((error: unknown) => error);
    ports[2]?.fail(new Error("Worker crashed."));

    await expect(workerError).resolves.toMatchObject({ message: "Worker crashed." });
    expect(ports[2]?.terminateCount).toBe(1);
  });

  it("rejects a valid-looking result for different run metadata", async () => {
    const { client, ports } = setupClient();
    const resultPromise = client.run(ASSUMPTIONS, OPTIONS);
    const rejection = resultPromise.catch((error: unknown) => error);
    ports[0]?.emit(completedResponse(1, ASSUMPTIONS, { ...OPTIONS, seed: 10 }));

    expect(await rejection).toBeInstanceOf(SimulationWorkerProtocolError);
    expect(ports[0]?.terminateCount).toBe(1);
  });
});
