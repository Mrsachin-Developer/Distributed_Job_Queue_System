"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addJobToQueue = addJobToQueue;
const redisClient_1 = require("../../shared/redis/redisClient");
const QUEUE_NAME = "job_queue";
async function addJobToQueue(job) {
    await redisClient_1.redisClient.rPush(QUEUE_NAME, JSON.stringify(job));
}
