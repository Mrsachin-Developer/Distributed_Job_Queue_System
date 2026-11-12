<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white" />
  <img src="https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white" />
</p>

# ⚡ Distributed Job Queue System

A **production-oriented distributed job queue** built from scratch, designed to explore reliable asynchronous processing, worker coordination, recovery, and observability — no BullMQ, no Celery, no SQS. Every component — the scheduler, the distributed lock manager, the partition rebalancer, the rate limiter, the recovery scanner — is **hand-engineered** to demonstrate deep systems-design understanding.

> **Why this project?** Most job queues are a `npm install bullmq` away. This one exists to prove I can *design* one: handle concurrency, recover from partial failures, reduce duplicate side effects through idempotency, and coordinate workers horizontally — with the trade-offs and failure modes documented.

---

## 📑 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [System Design Deep Dive](#-system-design-deep-dive)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Database Schema](#-database-schema)
- [API Reference](#-api-reference)
- [How It Works — Job Lifecycle](#-how-it-works--job-lifecycle)
- [Distributed Worker Coordination](#-distributed-worker-coordination)
- [Fault Tolerance & Recovery](#-fault-tolerance--recovery)
- [Observability Stack](#-observability-stack)
- [Benchmark Suite](#-benchmark-suite)
- [Getting Started](#-getting-started)
- [Configuration](#-configuration)

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLIENT / BENCHMARK                              │
│                          POST /jobs  ·  POST /jobs/batch                   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │        API SERVICE          │
                    │  ┌──────────┐ ┌───────────┐ │
                    │  │Rate Limit│ │  Back      │ │
                    │  │(Token    │ │  Pressure  │ │
                    │  │ Bucket)  │ │  Guard     │ │
                    │  └────┬─────┘ └─────┬─────┘ │
                    │       └──────┬──────┘       │
                    │              ▼              │
                    │     Job Controller          │
                    │     (Single + Batch)         │
                    └──────┬───────────┬──────────┘
                           │           │
              ┌────────────▼──┐  ┌─────▼────────────┐
              │  PostgreSQL   │  │   Redis            │
              │  (Source of   │  │   (Execution       │
              │   Truth)      │  │    Layer)          │
              │               │  │                    │
              │  ┌──────────┐ │  │  12 Partitioned    │
              │  │ Job Table│ │  │  Priority Queues   │
              │  │ + Indexes│ │  │  high:0-3          │
              │  └──────────┘ │  │  medium:0-3        │
              └───────────────┘  │  low:0-3           │
                                 └──────┬─────────────┘
                                        │
                     ┌──────────────────▼──────────────────┐
                     │       WORKER SERVICE (N instances)   │
                     │                                      │
                     │  ┌─────────┐  ┌──────────────────┐  │
                     │  │Partition│  │Weighted Scheduler │  │
                     │  │Ownership│  │  HIGH  = 5x      │  │
                     │  │+ Leases │  │  MEDIUM = 2x     │  │
                     │  └────┬────┘  │  LOW   = 1x      │  │
                     │       │       └──────────────────┘  │
                     │       ▼                              │
                     │  ┌──────────────────────────────┐   │
                     │  │  7-Step Job Processing        │   │
                     │  │  1. Atomic DB Claim           │   │
                     │  │  2. Redis Distributed Lock    │   │
                     │  │  3. Idempotency Check         │   │
                     │  │  4. Execute Business Logic    │   │
                     │  │  5. Mark Completed (DB)       │   │
                     │  │  6. Mark Processed (Redis)    │   │
                     │  │  7. Release Lock              │   │
                     │  └──────────────────────────────┘   │
                     └──────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼────────────────────────┐
              ▼                         ▼                        ▼
   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
   │ RECOVERY SCANNER │   │  ALERT SERVICE   │   │  PROMETHEUS METRICS  │
   │                  │   │                  │   │                      │
   │ • Stuck jobs     │   │ • Failure spike  │   │ • Queue depth        │
   │ • Missed enqueue │   │   detection      │   │ • Job duration       │
   │ • Auto-requeue   │   │ • Auto-resolve   │   │ • DB latency         │
   │ • Worker health  │   │ • Rate-based     │   │ • Active workers     │
   └──────────────────┘   └──────────────────┘   └──────────────────────┘
```

---

## 🔬 System Design Deep Dive

### Dual-Write Architecture (PostgreSQL + Redis)

Job creation currently follows a database-plus-Redis enqueue flow: PostgreSQL is the **durable source of truth**, while Redis is the **execution/coordination layer**. This is a dual-system workflow, so partial failures must be handled explicitly:

```
Client Request
     │
     ▼
┌─────────────────┐    ┌─────────────────┐
│  1. Write to DB  │───▶│  2. Push to     │
│  (Durable)       │    │  Redis Queue    │
│                  │    │  (Fast)         │
└─────────────────┘    └─────────────────┘
```

> **Why not just Redis?** Redis is used for fast queue operations, while PostgreSQL retains durable job records. Redis persistence and deployment configuration still affect its recovery characteristics.  
> **Why not just PostgreSQL?** Polling a DB for work is slow. Redis blocking list operations (such as `BLPOP`) let workers wait for available work instead of continuously polling.  
> **What if Redis push fails after DB write?** The Recovery Scanner catches exactly this — it scans for `QUEUED` jobs that never reached Redis and re-enqueues them.

### Hash-Based Queue Partitioning

Jobs are distributed across **4 partitions per priority level** (12 total queues) using a deterministic hash of the `userId` (the exact partitioning algorithm should be kept consistent with the implementation):

```
hash("user-abc") % 4 = 2  →  high_priority_queue:2
```

This routing approach aims to provide:
- **Same user's jobs are routed to the same partition** → co-locates that user's jobs; partition placement alone does not guarantee execution order
- **Load is evenly distributed** across partitions
- **Workers can own specific partitions** → reduces contention

---

## 🎯 Key Features

### 🔧 Core Queue Engine
| Feature | Implementation |
|---|---|
| **Priority Queues** | 3-tier (HIGH / MEDIUM / LOW) with weighted scheduling (5:2:1) |
| **Partitioned Queues** | 4 partitions per priority = 12 Redis lists, routed by a hash of `userId` |
| **Batch Ingestion** | Bulk `createMany` in PostgreSQL + parallel Redis pushes |
| **Duplicate-Execution Protection** | Atomic database state transitions, Redis locking, and idempotency checks; this does **not** provide end-to-end exactly-once guarantees |

### 🔄 Distributed Worker Coordination
| Feature | Implementation |
|---|---|
| **Horizontal Scaling** | Spin up N workers — partitions auto-rebalance via lease-based ownership |
| **Partition Leasing** | Redis `SET NX EX` with 30s TTL — workers claim & renew leases |
| **Fair Rebalance** | Workers calculate `ceil(partitions / workers)` and shed excess partitions |
| **Worker Registry** | Heartbeat-based registration (15s TTL) — dead workers auto-expire |
| **Graceful Shutdown** | `SIGINT`/`SIGTERM` handlers release partitions before exit |

### 🛡 Fault Tolerance
| Feature | Implementation |
|---|---|
| **Automatic Retries** | Configurable `maxRetries` with jittered backoff (2–3s randomized delay) |
| **Dead Letter Queue (DLQ)** | Jobs exceeding max retries move to `DLQ` status — never silently lost |
| **Stuck Job Recovery** | Recovery Scanner detects `PROCESSING` jobs with no heartbeat → re-queues |
| **Missed Enqueue Recovery** | Detects `QUEUED` jobs >10s old never pushed to Redis → re-enqueues |
| **Lock Safety** | Distributed Redis lock with 120s TTL prevents parallel execution |
| **DB State Revert** | If lock acquisition fails after DB claim, status reverts to `QUEUED` |

### 🚦 Traffic Control
| Feature | Implementation |
|---|---|
| **Rate Limiting** | Per-user Token Bucket via **Lua script** (atomic, no race conditions) — 100 tokens, 10/sec refill |
| **Back Pressure** | Queue depth monitoring: soft slowdown >5,000 jobs, hard reject >8,000 with `Retry-After` header |

### 📊 Observability
| Feature | Implementation |
|---|---|
| **Prometheus Integration** | Custom gauges + histograms exported on `/metrics` endpoint |
| **Real-Time Metrics** | Queue depth, active workers, processing count — all from Redis |
| **Performance Histograms** | Job duration, DB latency, business logic time — per-operation breakdown |
| **Failure Spike Alerting** | Sliding-window (3-min) failure rate detection with auto-resolve |
| **JSON Metrics API** | Cached (3s TTL) metrics endpoint for dashboards |

### 🏋️ Benchmark Suite
| Feature | Implementation |
|---|---|
| **Load Generator** | Configurable job count, batch size, priority distribution |
| **Fisher-Yates Shuffle** | Randomized priority distribution for realistic load patterns |
| **Detailed Reporting** | End-to-end throughput, queue-drain throughput, success/failure rates |
| **Largest Remainder Method** | Mathematically precise priority allocation (no rounding errors) |

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Runtime** | Node.js + TypeScript 5.9 | Type-safe backend |
| **Framework** | Express 5.2 | HTTP API layer |
| **Database** | PostgreSQL + Prisma 7.5 | Durable job storage (source of truth) |
| **Queue / Cache** | Redis 5.11 | Job queues, locks, metrics, rate limiting |
| **Monitoring** | Prometheus + prom-client | Time-series metrics & alerting |
| **DB Adapter** | @prisma/adapter-pg | Connection pooling via `pg` driver |

---

## 📁 Project Structure

```
Backend/
├── api-service/                    # REST API Layer
│   ├── server.ts                   # Express app, middleware chain, graceful shutdown
│   ├── dbclient.ts                 # Prisma client with pg adapter + connection pooling
│   ├── controllers/
│   │   ├── job.Controller.ts       # Single & batch job creation (DB + Redis dual-write)
│   │   └── metrics.Controller.ts   # Cached JSON metrics + Prometheus scrape endpoint
│   ├── middleware/
│   │   ├── rateLimitMiddleware.ts   # Per-user Token Bucket (Redis Lua script)
│   │   └── backPressure.middleware.ts # Adaptive queue-depth throttling
│   ├── queue/
│   │   └── jobQueue.ts             # Redis RPUSH abstraction
│   └── routes/
│       ├── job.routes.ts           # POST /jobs, POST /jobs/batch
│       └── metrics.routes.ts       # GET /metrics, GET /metrics/json
│
├── worker-service/                 # Distributed Workers
│   ├── workers/
│   │   └── worker.ts              # 600-line orchestrator: partition claiming,
│   │                              #   heartbeat, rebalance, 7-step processing
│   ├── processors/
│   │   └── jobProcessor.ts        # Business logic dispatcher (EMAIL, IMAGE, etc.)
│   └── scheduler/
│       └── schedular.ts           # Weighted round-robin with adaptive backoff
│
├── alert-service/
│   └── alert.ts                   # Sliding-window failure spike detector
│
├── recovery-service/
│   └── scanner.ts                 # Stuck & missed job recovery daemon
│
├── shared/                        # Shared infrastructure
│   ├── cluster/
│   │   └── workerRegistry.ts      # Worker heartbeat registration (Redis TTL)
│   ├── metrics/
│   │   ├── metrics.ts             # Redis-backed metric counters (per-type + totals)
│   │   ├── prometheus.ts          # Prometheus gauges, histograms, queue depth
│   │   └── metricsServer.ts       # Standalone metrics HTTP server for workers
│   ├── redis/
│   │   ├── redisClient.ts         # Redis connection with event handlers
│   │   └── tokenBucket.ts         # Atomic Lua rate-limiter script
│   └── utils/
│       ├── partition.ts           # Consistent hash → queue partition mapper
│       └── partitionOwnership.ts  # Redis-based lease claim / renew / release
│
├── benchmark/                     # Performance testing
│   ├── index.ts                   # Entry point
│   ├── benchmarkRunner.ts         # Orchestrator: submit → wait → report
│   ├── loadGenerator.ts           # Batch submission with priority distribution
│   ├── benchMarkReport.ts         # Throughput & success rate calculator
│   ├── config.ts                  # Tunable parameters
│   └── types.ts                   # TypeScript interfaces
│
├── prometheus/
│   └── prometheus.yml             # Scrape config (API + Worker targets)
│
└── prisma/
    └── schema.prisma              # Database schema with 7 indexes
```

---

## 🗄 Database Schema

```prisma
model Job {
  id           String      @id @default(uuid())
  payload      Json                              // Flexible JSON payload
  priority     JobPriority @default(MEDIUM)       // HIGH | MEDIUM | LOW
  status       JobStatus   @default(QUEUED)       // QUEUED → PROCESSING → COMPLETED | DLQ
  attempts     Int         @default(0)            // Current retry count
  maxRetries   Int         @default(3)            // Configurable retry limit
  startedAt    DateTime?                          // Processing start timestamp
  completedAt  DateTime?                          // Completion timestamp
  workerId     String?                            // Which worker owns this job
  errorMessage String?                            // Last error (for debugging)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  failedAt     DateTime?                          // DLQ timestamp
  type         String                             // Job type (EMAIL, IMAGE, etc.)
  userId       String                             // Owner / tenant

  @@index([userId])                // User lookups
  @@index([userId, status])        // User + status filter
  @@index([status])                // Queue scanning
  @@index([status, createdAt])     // Recovery scanner (missed jobs)
  @@index([status, startedAt])     // Recovery scanner (stuck jobs)
  @@index([completedAt])           // Completion reports
  @@index([createdAt])             // Time-range queries
}
```

> **7 indexes** are chosen to support query patterns used by the worker and recovery scanner. Indexes improve targeted lookups, but do not guarantee that every query avoids a sequential scan.

---

## 📡 API Reference

### `POST /jobs` — Create Single Job
```json
// Request
{
  "userId": "user-123",
  "type": "EMAIL",
  "priority": "high",
  "payload": { "to": "user@example.com", "subject": "Hello" },
  "maxRetries": 5
}

// Response (201)
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "userId": "user-123",
  "priority": "high"
}
```

### `POST /jobs/batch` — Bulk Job Submission
```json
// Request
{
  "userId": "user-123",
  "jobs": [
    { "type": "EMAIL", "priority": "high", "payload": { "to": "a@b.com" } },
    { "type": "IMAGE", "priority": "low", "payload": { "file": "img.png" } }
  ]
}

// Response (201)
{
  "message": "Batch processing completed",
  "totalReceived": 2,
  "totalAccepted": 2,
  "totalFailed": 0,
  "jobs": [...]
}
```

### `GET /metrics` — Prometheus Scrape Endpoint
### `GET /metrics/json` — JSON Metrics (3s cache)
### `GET /health` — Redis Health Check

---

## 🔄 How It Works — Job Lifecycle

```mermaid
stateDiagram-v2
    [*] --> QUEUED: Job Created
    QUEUED --> PROCESSING: Worker Claims (Atomic DB Update)
    PROCESSING --> COMPLETED: Success
    PROCESSING --> QUEUED: Retry (attempts < maxRetries)
    PROCESSING --> DLQ: Max Retries Exceeded
    QUEUED --> QUEUED: Recovery Scanner Re-enqueue
    PROCESSING --> QUEUED: Stuck Job Recovery
    COMPLETED --> [*]
    DLQ --> [*]
```

### The 7-Step Worker Processing Pipeline

```
Step 1: ATOMIC DB CLAIM
   └─ updateMany WHERE id=X AND status=QUEUED → SET status=PROCESSING
   └─ If 0 rows affected → another worker won → skip

Step 2: REDIS DISTRIBUTED LOCK
   └─ SET lock:{jobId} NX EX 120
   └─ If fails → revert DB to QUEUED (critical safety!)

Step 3: IDEMPOTENCY CHECK
   └─ EXISTS processed:{jobId} → if yes, skip (fast path)

Step 4: EXECUTE BUSINESS LOGIC
   └─ processJob(job) → EMAIL / IMAGE / custom handler

Step 5: MARK COMPLETED (DB)
   └─ UPDATE status=COMPLETED, completedAt=now()

Step 6: MARK PROCESSED (REDIS)
   └─ SET processed:{jobId} true EX 3600 (1hr TTL)

Step 7: RELEASE LOCK
   └─ DEL lock:{jobId}
```

> Each step has a specific purpose documented in inline comments — the separation between DB ownership, Redis locking, and idempotency checking is intentional defense-in-depth.

---

## 🤝 Distributed Worker Coordination

### Partition Ownership via Leases

```mermaid
sequenceDiagram
    participant W1 as Worker 1
    participant W2 as Worker 2
    participant R as Redis
    
    W1->>R: SET partition_owner:high:0 worker-1 NX EX 30
    R-->>W1: OK (claimed)
    
    W2->>R: SET partition_owner:high:0 worker-2 NX EX 30
    R-->>W2: nil (already owned)
    
    Note over W1,R: Every 5s: renew lease
    W1->>R: EXPIRE partition_owner:high:0 30
    
    Note over W1: Worker 1 crashes...
    Note over R: After 30s: key expires
    
    W2->>R: SET partition_owner:high:0 worker-2 NX EX 30
    R-->>W2: OK (claimed!)
```

### Auto-Rebalancing Algorithm

When workers join or leave, partitions automatically rebalance:

```
Fair Share = ceil(12 partitions / N workers)

2 workers → 6 partitions each
3 workers → 4 partitions each
4 workers → 3 partitions each

If a worker owns more than fairShare + 1:
  → Release excess partitions
  → Other workers claim them in their next claim cycle
```

### Weighted Round-Robin Scheduler

The scheduler ensures high-priority jobs get more CPU time *without starving* lower priorities:

```
Weight Ratio:  HIGH=5  MEDIUM=2  LOW=1

Schedule: [H, H, H, H, H, M, M, L]  (repeats)

Adaptive Backoff:
  • 3 consecutive empty polls → 500ms backoff on that queue
  • Job found → reset backoff immediately
```

---

## 🛡 Fault Tolerance & Recovery

### Recovery Scanner (Daemon)

Runs every **5 seconds**, handling two failure modes:

| Failure Mode | Detection | Recovery |
|---|---|---|
| **Missed Enqueue** | `QUEUED` jobs >10s old | Re-push to correct Redis partition |
| **Stuck Processing** | `PROCESSING` jobs >10s with dead worker | Reset to `QUEUED` + re-enqueue |

The scanner should consider worker liveness before reclaiming a job. A heartbeat is evidence of process liveness, not proof that a particular job is making progress; recovery thresholds and ownership checks must therefore be conservative.

### Alert Service

Sliding-window failure rate detection:

```
Every 30 seconds:
  1. Sum failures across last 3 minute-buckets
  2. If failureRate > 5% AND totalProcessed > 100:
     → SET alert:failure_spike "firing" NX EX 300
     → Log 🚨 ALERT
  3. If condition clears:
     → SET alert:failure_spike "ok" EX 300
     → Log ✅ RESOLVED
```

> Uses Redis `NX` to prevent duplicate alerts and `EX` to auto-clear stale state.

---

## 📊 Observability Stack

### Prometheus Metrics

> *The `_total` metrics are listed as counters following Prometheus conventions. Confirm that the exporter registers them as `Counter` metrics before relying on these types in dashboards. Live values such as queue depth, active workers, and currently processing jobs are gauges.

| Metric | Type | Description |
|---|---|---|
| `queue_processed_total` | Counter* | Total successfully processed jobs |
| `queue_failed_total` | Counter* | Total failed jobs |
| `queue_retry_total` | Counter* | Total retried jobs |
| `queue_dlq_total` | Counter* | Total jobs in Dead Letter Queue |
| `queue_processing_jobs` | Gauge | Currently processing job count |
| `queue_active_workers` | Gauge | Live worker count |
| `queue_depth` | Gauge (labeled) | Per-queue depth for all 12 partitions |
| `queue_job_duration_seconds` | Histogram | End-to-end job processing time |
| `queue_db_duration_seconds` | Histogram | Database operation latency |
| `queue_business_logic_duration_seconds` | Histogram | Business logic execution time |

### Prometheus Scrape Config

```yaml
scrape_interval: 5s

scrape_configs:
  - job_name: "api-service"       # localhost:3000/metrics
  - job_name: "worker-service"    # localhost:3001/metrics
```

---

## 🏋️ Benchmark Suite

The built-in benchmark suite generates realistic load and measures end-to-end throughput:

```bash
npm run benchmark
```

### Configuration

```typescript
{
  TOTAL_JOBS: 100,
  BATCH_SIZE: 10,
  PRIORITY_DISTRIBUTION: { HIGH: 50%, MEDIUM: 30%, LOW: 20% },
  PROCESSING_TIME_MS: { MIN: 0, MAX: 10 },
  BENCHMARK_TIMEOUT_MS: 600_000   // 10 min safety
}
```

### Recorded Benchmark Result

The following is the latest recorded 100-job run shared during development. It is an environment-specific observation, not a general performance guarantee. Results depend on the machine, database, Redis deployment, worker count, and configuration.

```
======================================
          Benchmark Report
======================================

--- Timing ---
Overall Duration          : 543.80 sec
Submission Duration       : not separately recorded in the available benchmark summary
Queue Drain Duration      : 543.72 sec

--- Throughput ---
End-to-End Throughput     : approximately 0.18 jobs/sec
Queue-Drain Throughput    : approximately 0.18 jobs/sec

--- Job Statistics ---
Configured Jobs           : 100
Submitted Jobs            : 100
Completed Jobs            : 100
Submission Failures        : 0
Failed Batches             : 0
Jobs in DLQ               : 0

--- Rates ---
Job Success Rate          : 100.00%
Submission Success Rate   : 100.00%
======================================
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **PostgreSQL** (running on port 5432)
- **Redis** (running on port 6379)

### Installation

```bash
# Clone the repository
git clone https://github.com/Mrsachin-Developer/Distributed_Job_Queue_System.git
cd Distributed_Job_Queue_System/Backend

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your PostgreSQL and Redis connection settings.
# Never commit .env or paste credentials into logs/reports.

# Run database migrations
npx prisma migrate dev

# Generate Prisma client (use the generator/configuration required by this repo)
npx prisma generate
```

### Running the System

```bash
# Terminal 1: Start the API server
npm run dev

# Terminal 2: Start a worker
npm run worker

# Terminal 3 (optional): Start additional workers for horizontal scaling
npm run worker

# Terminal 4 (optional): Run benchmarks
npm run benchmark
```

### Running with Prometheus

```bash
# Terminal 5: Start Prometheus
cd prometheus
./prometheus --config.file=prometheus.yml
# Dashboard available at http://localhost:9090
```

---

## ⚙ Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `PORT` | `3000` | API server port |
| `WORKER_METRICS_PORT` | `3001` | Worker Prometheus metrics port |
| `API_URL` | `http://localhost:3000/jobs/batch` | Benchmark target URL |

### Tunable Constants

| Constant | Value | Location | Purpose |
|---|---|---|---|
| Rate Limit Capacity | 100 tokens | `rateLimitMiddleware.ts` | Max burst per user |
| Refill Rate | 10/sec | `rateLimitMiddleware.ts` | Token regeneration |
| Backpressure Soft | 5,000 jobs | `backPressure.middleware.ts` | Add 50ms delay |
| Backpressure Hard | 8,000 jobs | `backPressure.middleware.ts` | Reject with 429 |
| Partition Lease TTL | 30s | `partitionOwnership.ts` | Ownership expiry |
| Worker Heartbeat TTL | 15s | `workerRegistry.ts` | Liveness timeout |
| Stuck Job Threshold | 10s | `scanner.ts` | Recovery trigger |
| Lock TTL | 120s | `worker.ts` | Execution safety window |
| Weighted Schedule | 5:2:1 | `schedular.ts` | Priority CPU allocation |

---

## ⚠️ Reliability Semantics and Known Limitations

- The system should be described as **at-least-once oriented** unless the complete processing path and every external side effect are made idempotent. A worker can perform a side effect and crash before persisting completion, so a retry may execute the handler again.
- Redis locks and database state transitions are coordination and duplicate-reduction mechanisms; they do not create a distributed transaction across PostgreSQL, Redis, and external services.
- A partition lease expiring does not physically stop a paused former owner. Operations that require strict stale-owner rejection need fencing/ownership validation at the protected write boundary.
- A successful benchmark on a local development setup does not establish production capacity. Publish hardware, worker count, dependency versions, and test configuration alongside performance claims.
- Verify every endpoint, metric name, metric type, threshold, and feature claim against the current source before treating this README as an implementation contract.

## 🧠 Design Decisions & Trade-offs

| Decision | Reasoning |
|---|---|
| **PostgreSQL as source of truth** | Durability guarantee — Redis is volatile |
| **Redis for queue operations** | `BLPOP` gives O(1) blocking dequeue; DB polling doesn't scale |
| **Lua-based rate limiter** | Atomic token bucket — no race conditions even under concurrent load |
| **Partition-based queues** | Spreads work across multiple queues and can co-locate jobs by user; strict per-user execution ordering requires additional coordination |
| **Lease-based ownership** | No centralized coordinator needed; crash recovery via TTL expiry |
| **Layered duplicate protection** | DB state claim, Redis lock, and idempotency check reduce duplicate execution risk but do not guarantee exactly-once external side effects |
| **Jittered retry delays** | `2000 + random(1000)ms` prevents thundering herd on retries |
| **Fail-open middleware** | Rate limiter and backpressure fail open — availability over strictness |
| **Recovery scanner batching** | `take: 50` limits per-scan to prevent DB overload |

---

<p align="center">
  Built with 💻 and a deep love for distributed systems.
</p>

