import { Router } from "express";
import { createJob } from "../controllers/job.Controller";

const router=Router();


router.post("/",createJob);

export default router;