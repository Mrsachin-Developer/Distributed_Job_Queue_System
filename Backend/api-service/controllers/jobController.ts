import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { addJobToQueue } from "../queue/jobQueue";

export async function createJob(req: Request, res: Response) {
  try {
    const jobId = uuidv4();

    const job = {
      id: jobId,
      type: req.body.type || "default",
      payload: req.body.payload || {},
      createdAt: new Date().toISOString(),
    };

    await addJobToQueue(job);

    res.status(201).json({
      message: "Job added to queue",
      jobId,
    });
  } catch (error) {
    console.error("Failed to create job:", error);

    res.status(500).json({
      message: "Internal server error",
    });
  }
}
