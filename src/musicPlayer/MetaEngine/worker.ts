import { parentPort, workerData } from "worker_threads";
import { MetaEngine } from "./MetaEngine";

const { cachePath, stagingPath, dbPath } = workerData;
const metaEngine = new MetaEngine(cachePath, stagingPath, dbPath);

if (parentPort) {
  parentPort.on("message", async (msg) => {
    const res = await metaEngine[msg.kind](...msg.args);
    msg.port.postMessage(res);
  });
}
