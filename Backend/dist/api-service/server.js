"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jobroutes_1 = __importDefault(require("./routes/jobroutes"));
const redisClient_1 = require("../shared/redis/redisClient");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.get("/", (req, res) => {
    res.send("API is running");
});
app.use("/jobs", jobroutes_1.default);
async function startServer() {
    await (0, redisClient_1.connectRedis)();
    app.listen(3000, () => {
        console.log("Server running on port 3000");
    });
}
startServer();
