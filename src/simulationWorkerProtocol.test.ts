import { describe, expect, it } from "vitest";
import {
  executeSimulationWorkerRequest,
  serializeSimulationError,
  type SimulationWorkerRequest,
} from "./simulationWorkerProtocol";
import {
  runSimulation,
  type PortfolioAssumptions,
} from "./simulation";

const ASSUMPTIONS: PortfolioAssumptions = {
  startingBalance: 10_000,
  monthlyContribution: 250,
  years: 2,
  annualReturn: 0.06,
  annualVolatility: 0.12,
  annualInflation: 0.02,
  annualFee: 0.0025,
  targetTodayValue: 20_000,
  targetSuccessBps: 8_000,
};

function request(
  overrides: Partial<SimulationWorkerRequest> = {},
): SimulationWorkerRequest {
  return {
    type: "run",
    requestId: 17,
    assumptions: ASSUMPTIONS,
    options: { scenarios: 25, seed: 42 },
    ...overrides,
  };
}

describe("simulation worker protocol", () => {
  it("returns the exact deterministic engine result with the request ID", () => {
    const workerRequest = request();
    const response = executeSimulationWorkerRequest(workerRequest);

    expect(response).toEqual({
      type: "completed",
      requestId: 17,
      result: runSimulation(ASSUMPTIONS, workerRequest.options),
    });
    expect(structuredClone(response)).toEqual(response);
  });

  it("serializes validation issues into cloneable plain data", () => {
    const response = executeSimulationWorkerRequest(
      request({ assumptions: { ...ASSUMPTIONS, years: 0 } }),
    );

    expect(response).toMatchObject({
      type: "failed",
      requestId: 17,
      error: {
        name: "SimulationValidationError",
        issues: [
          {
            field: "years",
            message: "Time horizon must be a whole number from 1 to 50 years.",
          },
        ],
      },
    });
    expect(structuredClone(response)).toEqual(response);
  });

  it("serializes option errors without relying on Error structured cloning", () => {
    const response = executeSimulationWorkerRequest(
      request({ options: { scenarios: 25, seed: -1 } }),
    );

    expect(response).toEqual({
      type: "failed",
      requestId: 17,
      error: {
        name: "RangeError",
        message: "Seed must be an unsigned 32-bit integer.",
      },
    });
  });

  it("uses a stable fallback for non-Error failures", () => {
    expect(serializeSimulationError("failure")).toEqual({
      name: "UnknownSimulationError",
      message: "The simulation worker failed with an unknown error.",
    });
  });
});
