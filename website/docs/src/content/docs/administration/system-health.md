---
title: System health
description: Check that Waffled is healthy — doctor, the health panel, and metrics.
---

Waffled ships a **deep health report** covering **db, migrations, jobs, calendar,
storage, and backup**. This page is how you read it, plus the optional metrics stack.
For symptom → fix, see [Troubleshooting](/operations/troubleshooting/).

## Four ways to see health

| Method | Depth | Who | Notes |
|---|---|---|---|
| `./waffled doctor` | deep, in-container | host | **Exits non-zero when anything is degraded/down** — good for cron/monitoring |
| **Settings → System Health** | deep | admin | Same report, in the UI |
| `GET /api/health` | deep, per-component JSON | admin | Machine-readable full report |
| `GET /healthz` | shallow | public | DB ping + version/build info; backs the container healthcheck |

`./waffled doctor` is the one to reach for first — because it **exits non-zero** when
anything is unhealthy, it drops straight into a cron job or an uptime monitor.

## Reading the report

### Backup line

The **backup** line turns **degraded** if the **last backup failed**, or the **newest
success is older than ~48 h** (two missed daily cycles). Fix it via
[Backup & restore](/operations/backup/).

### Migrations line

The **migrations** line flags **"schema behind"** when **applied < available**. Bring
the schema forward:

```bash
./waffled migrate
```

## Live Sync (this browser)

The System Health grid opens with one card that is **about the device you're holding**,
not the server: the browser's live-sync (PowerSync) engine, which mirrors the calendar
locally for instant offline reads.

| State | Meaning |
|---|---|
| **live** | Connected and fully synced — local reads are authoritative |
| **connecting…** | Establishing (or re-establishing) the sync stream |
| **stalled — auto-restarting** | Online + signed in but no sync for several minutes; the watchdog is restarting the engine |
| **offline** | No network — the local mirror serves the last-known state |
| **off — reading over REST** | The engine couldn't start; the app reads from the server directly |

A **stalled** engine is self-healing: the watchdog restarts it automatically (a gentle
reconnect first, then a full client rebuild, with growing pauses between tries), the
kiosk shows a quiet *"Live sync is reconnecting"* strip, and in the meantime the
calendar reads **straight from the server** — so a stalled sync never shows an empty
calendar. The card also lists the last successful sync time and how many watchdog
restarts have happened this session, and the **Restart sync** button forces a full
rebuild on the spot if you don't want to wait.

## Update notifier

Waffled checks GitHub for new releases and shows **"Update available — vX.Y.Z"** in
**System Health**.

| Env var | Default | Meaning |
|---|---|---|
| `UPDATE_CHECK_ENABLED` | on | Enable the release check |
| `UPDATE_CHECK_REPO` | — | Which repo to check |

When one is offered, act on it with `./waffled upgrade` — see
[Upgrading](/operations/upgrading/).

## Optional metrics & traces

Waffled can run a **local all-in-one observability stack** (Grafana / Prometheus /
Tempo / Loki) via the `observability` compose profile, and point the api's OTEL
exporter at it:

```bash
./waffled observability up      # bring up Grafana/Prometheus/Tempo/Loki
./waffled observability down     # turn it back off
```

- **Grafana** runs on **port 3001**, login **admin / admin**.
- **OpenTelemetry is OFF by default** — there's no `OTEL_EXPORTER_OTLP_ENDPOINT` set
  until you bring the stack up (or point it at your own collector).

## Logs

Tune log output in `infra/compose/.env`:

| Env var | Purpose |
|---|---|
| `LOG_LEVEL` | Verbosity |
| `LOG_FORMAT` | Log format |

## See also

- [Troubleshooting](/operations/troubleshooting/) — symptom → diagnosis → fix
- [Backup & restore](/operations/backup/) — fix a degraded backup line
- [Upgrading](/operations/upgrading/) — act on the update notifier
