import { redisClient } from "../redis/redisClient";

const LEASE_TTL = 30;

function getPartitionOwnerKey(queue: string) {
  return `partition_owner:${queue}`;
}

/**
 * Try claiming partition ownership
 */
export async function claimPartition(queue: string, workerId: string) {
  const key = getPartitionOwnerKey(queue);

  const result = await redisClient.set(key, workerId, {
    NX: true,
    EX: LEASE_TTL,
  });

  return result === "OK";
}

/**
 * Renew lease if already owner
 */
export async function renewPartitionLease(queue: string, workerId: string) {
  const key = getPartitionOwnerKey(queue);

  const currentOwner = await redisClient.get(key);

  if (currentOwner !== workerId) {
    return false;
  }

  await redisClient.expire(key, LEASE_TTL); // and resets it back to: LEASE_TTL

  return true;
}

/**
 * Release ownership gracefully
 */
export async function releasePartition(queue: string, workerId: string) {
  const key = getPartitionOwnerKey(queue);

  const currentOwner = await redisClient.get(key);

  if (currentOwner === workerId) {
    await redisClient.del(key);
  }
}
