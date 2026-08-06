import express from "express";
import { register } from "./prometheus";

const app = express();

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

export function startMetricsServer(port: number) {
  app.listen(port, () => {
    console.log(`📊 Metrics server running on port ${port}`);
  });
}