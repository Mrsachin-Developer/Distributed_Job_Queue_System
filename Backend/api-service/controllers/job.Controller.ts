import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import prisma from "../dbclient";
import { addJobToQueue } from "../queue/jobQueue";
import { JobPriority } from "../../generated/prisma/index";
import { getPartitionedQueue } from "../../shared/utils/partition";
type Priority = "high" | "medium" | "low";


const PRIORITY_DB_MAP: Record<Priority, JobPriority> = {
  high: JobPriority.HIGH,
  medium: JobPriority.MEDIUM,
  low: JobPriority.LOW,
};
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
    if (typeof req.body.userId !== "string" || req.body.userId.trim() === "") {
      return res.status(400).json({
        message: "Valid userId is required",
      });
    }
    // Normalize priority
    let priority = (req.body.priority || "medium").toLowerCase();

    if (!["high", "medium", "low"].includes(priority)) {
      priority = "medium";
    }

    const safePriority = priority as Priority;

    const jobData = {
      id: jobId,
      userId: req.body.userId,
      type: req.body.type,
      priority: safePriority,
      payload: req.body.payload || {},
    };

    /**
     * STEP 1: INSERT INTO DB (SOURCE OF TRUTH)
     */
    await prisma.job.create({
      data: {
        id: jobId,
        type: jobData.type,
        userId: req.body.userId,
        payload: jobData.payload,
        priority: PRIORITY_DB_MAP[safePriority],
        status: "QUEUED",
        attempts: 0,
        maxRetries: req.body.maxRetries || 3,
        createdAt: new Date(),
      },
    });

    /**
     * STEP 2: PUSH TO REDIS (EXECUTION LAYER)
     */
    const queueName = getPartitionedQueue(safePriority, req.body.userId);

    await addJobToQueue(queueName, jobData);

    /**
     * RESPONSE
     */
    return res.status(201).json({
      jobId,
      status: "QUEUED",
      userId: req.body.userId,
      priority: safePriority,
    });
  } catch (error) {
    console.error("CreateJob Error:", error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
}
