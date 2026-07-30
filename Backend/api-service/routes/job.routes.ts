import { Router } from "express";
import { createBatchJobs, createJob } from "../controllers/job.Controller";

const router = Router();

router.post("/", createJob);
router.post("/batch", createBatchJobs);

export default router;
