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
  } catch (error: any) {
    console.error(error);

    res.status(500).json({
      message: error.message,
    });
  }
}

interface ValidJob {
  id: string;
  userId: string;
  type: string;
  payload: any;
  priority: Priority;
  maxRetries: number;
  createdAt: Date;
}
export async function createBatchJobs(req: Request, res: Response) {
  console.log("ENTERED createBatchJobs");
  try {
    const { userId, jobs } = req.body;

    if (typeof userId !== "string" || userId.trim() === "") {
      return res.status(400).json({
        message: "Valid userId is required",
      });
    }

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({
        message: "Jobs array is required",
      });
    }

    const validJobs: ValidJob[] = [];
    for (const job of jobs) {
      if (!job.type) continue;

      let priority = (job.priority || "medium").toLowerCase();

      if (!["high", "medium", "low"].includes(priority)) {
        priority = "medium";
      }

      const safePriority = priority as Priority;

      validJobs.push({
        id: uuidv4(),
        userId,
        type: job.type,
        payload: job.payload || {},
        priority: safePriority,
        maxRetries: job.maxRetries || 3,
        createdAt: new Date(),
      });
    }

    if (validJobs.length === 0) {
      return res.status(400).json({
        message: "No valid jobs found",
      });
    }

    /**
     * STEP 1
     * Bulk insert into PostgreSQL
     */

    console.log("1. Request validated");

    console.log("2. Before createMany");

    await prisma.job.createMany({
      data: validJobs.map((job) => ({
        id: job.id,
        type: job.type,
        userId: job.userId,
        payload: job.payload,
        priority: PRIORITY_DB_MAP[job.priority],
        status: "QUEUED",
        attempts: 0,
        maxRetries: job.maxRetries,
        createdAt: job.createdAt,
      })),
    });

    console.log("3. After createMany");
    console.log(
      "4. Queue:",
      getPartitionedQueue(validJobs[0].priority, validJobs[0].userId),
    );
    /**
     * STEP 2
     * Push every job to Redis in parallel
     */
    await Promise.all(
      validJobs.map((job) => {
        const queueName = getPartitionedQueue(job.priority, job.userId);

        return addJobToQueue(queueName, {
          id: job.id,
          userId: job.userId,
          type: job.type,
          priority: job.priority,
          payload: job.payload,
        });
      }),
    );
    console.log("5. Redis enqueue complete");
    return res.status(201).json({
      message: "Batch processing completed",
      totalReceived: jobs.length,
      totalAccepted: validJobs.length,
      totalFailed: jobs.length - validJobs.length,
      jobs: validJobs.map((job) => ({
        jobId: job.id,
        priority: job.priority,
      })),
    });
  } catch (error: any) {
    console.error("========== FULL ERROR ==========");
    console.error(error);

    return res.status(500).json({
      message: error.message,
      stack: error.stack,
    });
  }
}
