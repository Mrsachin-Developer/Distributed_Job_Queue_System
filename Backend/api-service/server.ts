import express from "express";
import dotenv from "dotenv";
import jobRouter from "./routes/job.routes";
import metricsRouter from "./routes/metrics.routes";
import { connectRedis, redisClient } from "../shared/redis/redisClient";
import { rateLimitMiddleware } from "./middleware/rateLimitMiddleware";
import { backPressureMiddleware } from "./middleware/backPressure.middleware";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use((req, res, next) => {
  console.log("================================");
  console.log("REQUEST RECEIVED");
  console.log(req.method, req.originalUrl);
  console.log("================================");
  next();
});
app.use(
  express.json({
    limit: "10mb",
  }),
);
app.use((err: any, req: any, res: any, next: any) => {
  console.error("JSON PARSE ERROR");
  console.error(err);

  res.status(400).json({
    message: err.message,
  });
});
app.get("/", (req, res) => {
  res.send("API is running");
});
app.use((req, res, next) => {
  console.log("REQUEST RECEIVED");
  next();
});
app.get("/health", async (req, res) => {
  try {
    await redisClient.ping();
    res.status(200).json({ status: "OK" });
  } catch {
    res.status(500).json({ status: "DOWN" });
  }
});
app.use(rateLimitMiddleware);
app.use(backPressureMiddleware);

app.use("/jobs", jobRouter);
app.use("/metrics", metricsRouter);

// global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("===== GLOBAL ERROR =====");
  console.error(err);
  console.error("Message:", err.message);
  console.error("Stack:", err.stack);

  res.status(err.status || 500).json({
    success: false,
    message: err.message,
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
