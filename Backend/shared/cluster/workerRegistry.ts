import { redisClient } from "../redis/redisClient";

const WORKER_TTL = 15;
function getWorkerKey(workerId: string) {
  return `active_worker:${workerId}`;
}

// Register Worker
export async function registerWorker(workerId: string) {
  const key = getWorkerKey(workerId);

  await redisClient.set(key, "alive", {
    EX: WORKER_TTL,
  });
  console.log(`🟢Registered worker ${workerId}`);
}

//Renew worker HEARTBEAT

export async function renewWorkerHeartbeat(workerId: string) {
  const key = getWorkerKey(workerId);
  const exists = await redisClient.exists(key);

  if (!exists) {
    console.log(`❌ Worker missing from registry ${workerId}`);
    return false;
  }

  await redisClient.expire(key, WORKER_TTL);
  console.log(`💓 Renewed worker heartbeat ${workerId}`);
  return true;
}

/// Get Active Workers

export async function getActiveWorkers() {
  const keys = await redisClient.keys("active_worker:*");

  return keys.map((key) => {
    return key.replace("active_worker:", "");
  });
}

export async function removeWorker(workerId: string) {
  const key = getWorkerKey(workerId);

  await redisClient.del(key);

  console.log(`🔴 Removed worker ${workerId}`);
}
