import type {
  SerializedSimulationError,
  SimulationWorkerOptions,
  SimulationWorkerRequest,
  SimulationWorkerResponse,
} from "./simulationWorkerProtocol";
import type { PortfolioAssumptions, SimulationResult, ValidationIssue } from "./simulation";

export interface SimulationWorkerHandlers {
  onMessage(response: unknown): void;
  onError(error: unknown): void;
}

export interface SimulationWorkerPort {
  setHandlers(handlers: SimulationWorkerHandlers): void;
  postMessage(message: SimulationWorkerRequest): void;
  terminate(): void;
}

export type SimulationWorkerFactory = () => SimulationWorkerPort;

interface ActiveSimulationRequest {
  requestId: number;
  port: SimulationWorkerPort;
  options: SimulationWorkerOptions;
  resolve: (result: SimulationResult) => void;
  reject: (error: Error) => void;
}

export class SimulationCancelledError extends Error {
  constructor(message = "The simulation run was canceled.") {
    super(message);
    this.name = "SimulationCancelledError";
  }
}

export class SimulationWorkerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationWorkerProtocolError";
  }
}

export class RemoteSimulationError extends Error {
  readonly remoteName: string;
  readonly issues?: ValidationIssue[];

  constructor(error: SerializedSimulationError) {
    super(error.message);
    this.name = error.name || "RemoteSimulationError";
    this.remoteName = error.name;
    this.issues = error.issues?.map((issue) => ({ ...issue }));
  }
}

function createBrowserWorkerPort(): SimulationWorkerPort {
  const worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
    type: "module",
    name: "northstar-simulation",
  });

  return {
    setHandlers(handlers) {
      worker.onmessage = (event: MessageEvent<unknown>) => {
        handlers.onMessage(event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        handlers.onError(
          new Error(event.message || "The simulation worker stopped unexpectedly."),
        );
      };
      worker.onmessageerror = () => {
        handlers.onError(
          new Error("The simulation worker returned data that could not be read."),
        );
      };
    },
    postMessage(message) {
      worker.postMessage(message);
    },
    terminate() {
      worker.terminate();
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSerializedError(value: unknown): value is SerializedSimulationError {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    (value.issues === undefined || Array.isArray(value.issues))
  );
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isDistribution(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNonnegative(value.p10) &&
    isFiniteNonnegative(value.p25) &&
    isFiniteNonnegative(value.p50) &&
    isFiniteNonnegative(value.p75) &&
    isFiniteNonnegative(value.p90)
  );
}

function isSimulationResult(value: unknown): value is SimulationResult {
  if (!isRecord(value) || !Array.isArray(value.points)) return false;
  if (
    !Number.isFinite(value.successProbability) ||
    !Number.isSafeInteger(value.scenarioCount) ||
    !Number.isSafeInteger(value.seed) ||
    typeof value.modelVersion !== "string" ||
    !isFiniteNonnegative(value.targetNominal) ||
    !Number.isSafeInteger(value.successfulScenarios) ||
    !isRecord(value.samplingInterval) ||
    !Number.isFinite(value.samplingInterval.lower) ||
    !Number.isFinite(value.samplingInterval.upper) ||
    !Number.isFinite(value.samplingInterval.confidenceLevel) ||
    !isRecord(value.planning)
  ) {
    return false;
  }

  const planning = value.planning;
  const nullableNonnegative = (candidate: unknown) =>
    candidate === null || isFiniteNonnegative(candidate);
  if (
    !Number.isSafeInteger(planning.targetSuccessBps) ||
    !nullableNonnegative(planning.requiredMonthlyContribution) ||
    typeof planning.requiredContributionExceedsModelLimit !== "boolean" ||
    !nullableNonnegative(planning.monthlyContributionGap) ||
    !isFiniteNonnegative(planning.supportedGoalToday) ||
    !nullableNonnegative(planning.averageGoalShortfall) ||
    !isFiniteNonnegative(planning.lowerTailAverage) ||
    !isFiniteNonnegative(planning.medianNetNominalMaxDrawdown) ||
    !isFiniteNonnegative(planning.p90NetNominalMaxDrawdown)
  ) {
    return false;
  }

  return value.points.every(
    (point) =>
      isRecord(point) &&
      Number.isSafeInteger(point.year) &&
      isDistribution(point.nominal) &&
      isDistribution(point.real) &&
      isFiniteNonnegative(point.investedNominal) &&
      isFiniteNonnegative(point.investedReal),
  );
}

function isSimulationWorkerResponse(value: unknown): value is SimulationWorkerResponse {
  if (!isRecord(value) || !Number.isSafeInteger(value.requestId)) {
    return false;
  }

  if (value.type === "completed") {
    return isSimulationResult(value.result);
  }

  return value.type === "failed" && isSerializedError(value.error);
}

function normalizeWorkerError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error("The simulation worker stopped unexpectedly.");
}

/** Runs at most one simulation at a time and owns a fresh worker for each run. */
export class SimulationWorkerClient {
  private activeRequest: ActiveSimulationRequest | null = null;
  private requestSequence = 0;

  constructor(
    private readonly workerFactory: SimulationWorkerFactory = createBrowserWorkerPort,
  ) {}

  get activeRequestId(): number | null {
    return this.activeRequest?.requestId ?? null;
  }

  run(
    assumptions: PortfolioAssumptions,
    options: SimulationWorkerOptions,
  ): Promise<SimulationResult> {
    this.cancel("The simulation run was superseded by a newer run.");

    let port: SimulationWorkerPort;
    try {
      port = this.workerFactory();
    } catch (error) {
      return Promise.reject(normalizeWorkerError(error));
    }

    this.requestSequence += 1;
    const requestId = this.requestSequence;
    const requestOptions = { ...options };
    const request: SimulationWorkerRequest = {
      type: "run",
      requestId,
      assumptions,
      options: requestOptions,
    };

    return new Promise<SimulationResult>((resolve, reject) => {
      this.activeRequest = {
        requestId,
        port,
        options: requestOptions,
        resolve,
        reject,
      };

      try {
        port.setHandlers({
          onMessage: (response) => {
            this.handleResponse(requestId, response);
          },
          onError: (error) => {
            this.rejectRequest(requestId, normalizeWorkerError(error));
          },
        });
        port.postMessage(request);
      } catch (error) {
        this.rejectRequest(requestId, normalizeWorkerError(error));
      }
    });
  }

  cancel(message = "The simulation run was canceled."): boolean {
    const active = this.activeRequest;
    if (!active) {
      return false;
    }

    this.activeRequest = null;
    active.port.terminate();
    active.reject(new SimulationCancelledError(message));
    return true;
  }

  private handleResponse(expectedRequestId: number, response: unknown): void {
    if (this.activeRequest?.requestId !== expectedRequestId) {
      return;
    }

    if (!isSimulationWorkerResponse(response)) {
      this.rejectRequest(
        expectedRequestId,
        new SimulationWorkerProtocolError("The simulation worker returned an invalid response."),
      );
      return;
    }

    if (response.requestId !== expectedRequestId) {
      this.rejectRequest(
        expectedRequestId,
        new SimulationWorkerProtocolError("The simulation worker returned the wrong request ID."),
      );
      return;
    }

    if (response.type === "failed") {
      this.rejectRequest(expectedRequestId, new RemoteSimulationError(response.error));
      return;
    }

    const active = this.activeRequest;
    if (
      response.result.seed !== active.options.seed ||
      response.result.scenarioCount !== active.options.scenarios
    ) {
      this.rejectRequest(
        expectedRequestId,
        new SimulationWorkerProtocolError(
          "The simulation worker returned result metadata for a different run.",
        ),
      );
      return;
    }

    this.resolveRequest(expectedRequestId, response.result);
  }

  private resolveRequest(requestId: number, result: SimulationResult): void {
    const active = this.takeRequest(requestId);
    if (!active) {
      return;
    }

    active.port.terminate();
    active.resolve(result);
  }

  private rejectRequest(requestId: number, error: Error): void {
    const active = this.takeRequest(requestId);
    if (!active) {
      return;
    }

    active.port.terminate();
    active.reject(error);
  }

  private takeRequest(requestId: number): ActiveSimulationRequest | null {
    if (this.activeRequest?.requestId !== requestId) {
      return null;
    }

    const active = this.activeRequest;
    this.activeRequest = null;
    return active;
  }
}
