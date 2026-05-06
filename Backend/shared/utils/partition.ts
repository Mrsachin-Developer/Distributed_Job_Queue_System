const NUM_PARTITIONS = 4;

export function hashString(str: string): number {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }

  return hash;
}

export function getPartitionedQueue(priority: string, userId: string) {
  const hash = hashString(userId);

  const partition = hash % NUM_PARTITIONS;

  return `${priority}_priority_queue:${partition}`;
}
