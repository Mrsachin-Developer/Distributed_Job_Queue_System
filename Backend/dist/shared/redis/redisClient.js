"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisClient = void 0;
exports.connectRedis = connectRedis;
const redis_1 = require("redis");
exports.redisClient = (0, redis_1.createClient)({
    url: "redis://localhost:6379",
});
exports.redisClient.on("connect", () => {
    console.log("Connecting to Redis...");
});
exports.redisClient.on("ready", () => {
    console.log("Redis is ready");
});
exports.redisClient.on("error", (error) => {
    console.error("Redis error:", error);
});
async function connectRedis() {
    await exports.redisClient.connect();
}
