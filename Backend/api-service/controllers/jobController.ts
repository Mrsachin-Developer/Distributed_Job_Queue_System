import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { addJobToQueue } from "../queue/jobQueue";
import { redisClient } from "../../shared/redis/redisClient";

type Priority = "high" | "medium" | "low";

const PRIORITY_QUEUE_MAP: Record<Priority, string> = {
  high: "high_priority_queue",
  medium: "medium_priority_queue",
  low: "low_priority_queue",
};

export async function createJob(req: Request, res: Response) {
  try {
    const jobId = uuidv4();

    if (!req.body.type) {
      return res.status(400).json({ message: "Job type is required" });
    }

    // normalize + validate priority
    let priority = (req.body.priority || "medium").toLowerCase();

    if (!["high", "medium", "low"].includes(priority)) {
      priority = "medium";
    }
    const safePriority = priority as Priority;

    const job = {
      id: jobId,
      type: req.body.type,
      priority:safePriority,
      payload: req.body.payload || {},
      createdAt: new Date().toISOString(),
    };

    // store job state
    await redisClient.set(
      `job:${job.id}`,
      JSON.stringify({
        status: "queued",
        result: null,
        error: null,
        retryCount: 0,
        createdAt: new Date().toISOString(),
        jobData: job,
      }),
      { EX: 3600 },
    );

    // mapping
    const queueName = PRIORITY_QUEUE_MAP[safePriority];

    await addJobToQueue(queueName, job);

    res.status(201).json({
      jobId,
      status: "queued",
      priority: safePriority,
    });
  } catch (error) {
    console.error("CreateJob Error:", error);

    res.status(500).json({
      message: "Internal server error",
    });
  }
}
