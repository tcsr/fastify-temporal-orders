# Fastify + Temporal Orders API

Companion project for *Fastify + Temporal – Durable HTTP APIs with Node.js*.
A Fastify API (validation, idempotency, long-polling, error mapping) in front of the
Temporal order workflow from the Temporal tutorial.

## Run

```bash
npm install
npm run dev-server   # terminal 1 – or: temporal server start-dev (UI: http://localhost:8233)
npm run worker       # terminal 2
npm run api          # terminal 3 – http://localhost:3000, Swagger UI at /docs
npm test             # 7 end-to-end tests (HTTP -> workflow) on a time-skipping server
```

## Endpoints

| Method & path | Notes |
|---|---|
| `POST /orders` | Optional `Idempotency-Key` header; returns `202` + `Location` |
| `GET /orders/{id}` | Business status (workflow query) + execution status |
| `POST /orders/{id}/approve` | `{"approver": "..."}` – sends a signal |
| `POST /orders/{id}/cancel` | Sends a signal |
| `GET /orders/{id}/result?waitSeconds=0..30` | `200` result, `202` still running, `422` failed |
| `GET /health` | `503` when Temporal is unreachable |

Verified with Node 24.15, Fastify 5.12.5, @temporalio/* 1.24.0, Temporal CLI 1.9.1,
TypeScript 7.0.2.
