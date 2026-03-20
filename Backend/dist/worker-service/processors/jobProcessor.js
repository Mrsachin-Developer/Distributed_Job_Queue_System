"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processJob = processJob;
async function processJob(job) {
    console.log("Processing job:", job.type);
    switch (job.type) {
        case "EMAIL":
            await handleEmail(job.payload);
            break;
        case "IMAGE":
            await handleImage(job.payload);
            break;
        default:
            console.log("Unknown job type");
    }
    console.log("Job completed:", job.id);
}
// Simulated handlers
async function handleEmail(payload) {
    console.log("Sending email to:", payload.to);
    // simulate delay
    await new Promise((res) => setTimeout(res, 2000));
}
async function handleImage(payload) {
    console.log("Processing image:", payload.file);
    await new Promise((res) => setTimeout(res, 3000));
}
