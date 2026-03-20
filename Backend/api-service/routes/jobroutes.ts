import { Router } from "express";
import { createJob } from "../controllers/jobController";

const router=Router();


router.post("/",createJob);

export default router;