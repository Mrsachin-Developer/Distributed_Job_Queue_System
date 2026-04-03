import express from "express";

import { getMetrics } from "../controllers/metrics.Controller";
import e from "express";

const router = express.Router();

router.get("/metrics", getMetrics);

export default router;
