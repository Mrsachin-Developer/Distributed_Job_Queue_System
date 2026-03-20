"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJob = createJob;
const uuid_1 = require("uuid");
const jobQueue_1 = require("../queue/jobQueue");
async function createJob(req, res) {
    try {
        const jobId = (0, uuid_1.v4)();
        const job = {
            id: jobId,
            type: req.body.type || "default",
            payload: req.body.payload || {},
            createdAt: new Date().toISOString(),
        };
        await (0, jobQueue_1.addJobToQueue)(job);
        res.status(201).json({
            message: "Job added to queue",
            jobId,
        });
    }
    catch (error) {
        console.error("Failed to create job:", error);
        res.status(500).json({
            message: "Internal server error",
        });
    }
}
