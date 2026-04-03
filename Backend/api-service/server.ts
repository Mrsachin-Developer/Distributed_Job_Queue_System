import express from "express";
import dotenv from "dotenv";
import jobRouter from "./routes/job.routes";
import metricsRouter from "./routes/metrics.routes";
import { connectRedis, redisClient } from "../shared/redis/redisClient";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("API is running");
});

app.get("/health", async (req, res) => {
  try {
    await redisClient.ping();
    res.status(200).json({ status: "OK" });
  } catch {
    res.status(500).json({ status: "DOWN" });
  }
});

app.use("/jobs", jobRouter);
app.use("/metrics", metricsRouter);

// global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
});

async function startServer() {
  try {
    await connectRedis();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// graceful shutdown
process.on("SIGINT", () => {
  console.log("🛑 Shutting down...");
  process.exit(0);
});

startServer();
