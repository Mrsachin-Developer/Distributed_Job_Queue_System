import express from "express";
import jobRouter from "./routes/jobroutes";
import { connectRedis } from "../shared/redis/redisClient";
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API is running");
});

app.use("/jobs", jobRouter);
async function startServer() {
  await connectRedis();

  app.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}

startServer();
