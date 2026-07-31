import express from "express";
import { getMetrics, getPrometheusMetrics } from "../controllers/metrics.Controller";

const router = express.Router();

router.get("/", getPrometheusMetrics);   // Prometheus
router.get("/json", getMetrics);         // Existing JSON API

export default router;