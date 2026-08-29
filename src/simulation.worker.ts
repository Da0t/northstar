import {
  executeSimulationWorkerRequest,
  type SimulationWorkerRequest,
  type SimulationWorkerResponse,
} from "./simulationWorkerProtocol";

interface SimulationWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SimulationWorkerRequest>) => void,
  ): void;
  postMessage(message: SimulationWorkerResponse): void;
}

const workerScope = globalThis as unknown as SimulationWorkerScope;

workerScope.addEventListener("message", (event) => {
  workerScope.postMessage(executeSimulationWorkerRequest(event.data));
});
