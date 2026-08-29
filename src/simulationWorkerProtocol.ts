import {
  SimulationValidationError,
  runSimulation,
  type PortfolioAssumptions,
  type SimulationResult,
  type ValidationIssue,
} from "./simulation";

export interface SimulationWorkerOptions {
  scenarios: number;
  seed: number;
}

export interface SimulationWorkerRequest {
  type: "run";
  requestId: number;
  assumptions: PortfolioAssumptions;
  options: SimulationWorkerOptions;
}

export interface SerializedSimulationError {
  name: string;
  message: string;
  issues?: ValidationIssue[];
}

export type SimulationWorkerResponse =
  | {
      type: "completed";
      requestId: number;
      result: SimulationResult;
    }
  | {
      type: "failed";
      requestId: number;
      error: SerializedSimulationError;
    };

export function serializeSimulationError(
  error: unknown,
): SerializedSimulationError {
  if (error instanceof SimulationValidationError) {
    return {
      name: error.name,
      message: error.message,
      issues: error.issues.map((issue) => ({ ...issue })),
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "The simulation worker failed without an error message.",
    };
  }

  return {
    name: "UnknownSimulationError",
    message: "The simulation worker failed with an unknown error.",
  };
}

/** Executes one worker request without relying on worker-global APIs. */
export function executeSimulationWorkerRequest(
  request: SimulationWorkerRequest,
): SimulationWorkerResponse {
  try {
    return {
      type: "completed",
      requestId: request.requestId,
      result: runSimulation(request.assumptions, request.options),
    };
  } catch (error) {
    return {
      type: "failed",
      requestId: request.requestId,
      error: serializeSimulationError(error),
    };
  }
}
