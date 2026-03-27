import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { addJobToQueue } from "../queue/jobQueue";
import { redisClient } from "../../shared/redis/redisClient";

export async function createJob(req: Request, res: Response) {
  try {
    const jobId = uuidv4();

    if (!req.body.type) {
  return res.status(400).json({ message: "Job type is required" });
}
    const job = {
      id: jobId,
      type: req.body.type,
      payload: req.body.payload || {},
      createdAt: new Date().toISOString(),
    };

    await redisClient.set(
      `job:${job.id}`,
      JSON.stringify({
        status: "queued",
        result: null,
        error: null,
        retryCount:0,
        createdAt:new Date().toISOString(),
      
      }),
      {
        EX: 3600, // expire in 1 hour
      },
    );
    await addJobToQueue(job);

    res.status(201).json({
      jobId,
      status: "queued",
    });
  } catch (error) {
console.error("CreateJob Error:", error);

    res.status(500).json({
      message: "Internal server error",
    });
  }
}
