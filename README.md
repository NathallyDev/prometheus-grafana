# prometheus-grafana

Prometheus + Grafana orchestrated with Docker Compose, with datasource and dashboard provisioning and a web viewer for embedding dashboards.

## Quick Overview

Prerequisites: Docker and Docker Compose installed on the host.

1) Upload the stack in the background (PowerShell):

```powershell
docker compose up -d
```

2) Services (default in this repository):

- Grafana: http://localhost:3000 (username: admin / password: admin)
- Prometheus: http://localhost:9090

3) Local viewer (static frontend):

Serve the `web/` folder (e.g., Python HTTP server) and open the viewer:

```powershell
# from the repository root
python -m http.server 8000 --directory web
# then access
http://localhost:8000/grafana-viewer.html
```

## Main structure

- `docker-compose.yml` - orchestrates Grafana, Prometheus, and exporters.
- `grafana/` - Grafana configuration, provisioning files, and JSON dashboards.
- `grafana/grafana.ini` - Grafana server configuration file.
- `grafana/provisioning/` - Automatically provisioned datasources and dashboards.
- `prometheus/prometheus.yml` - Prometheus scraping configuration.
- `web/grafana-viewer.html` - Static viewer created to embed Grafana dashboards.

## Provisioning

The repository already provisions a datasource pointing to the Prometheus service (internal URL `http://prometheus:9090`) and a sample dashboard in `grafana/dashboards/`.

To add dashboards:

1. Place the dashboard JSON in `grafana/dashboards/`. 2. Restart the Grafana container (or wait for provisioning when starting):

```powershell
# restart only Grafana
docker compose restart Grafana
# or rebuild
docker compose up -d --build Grafana
```

## Important Grafana Settings

- If you need to allow embedding in iframes, confirm it in both ways:

1) In `grafana/grafana.ini` (example):

```ini
[security]
allow_embedding = true

[server]
# default port used in the container
http_port = 3000
```

2) In `docker-compose.yml`, export the environment variable (e.g., `GF_SECURITY_ALLOW_EMBEDDING=true`).

If you use a reverse proxy (NGINX, Traefik, etc.), also check that it is not injecting headers like `X-Frame-Options`.

To allow anonymous access (optional):

```ini
[auth.anonymous]
enabled = true
org_role = Viewer
```

After editing `grafana.ini` or environment variables, restart the Grafana container.

## Common Troubleshooting

- Port in Use/Conflict on Windows

If port 3000 is being used by another process (e.g., a local Grafana installation on Windows), check and end the process before mapping `3000:3000` in Docker.

Example commands in PowerShell (run as Administrator if you need to end the process):

```powershell
# view ports and PIDs (PowerShell)
netstat -aon | findstr ":3000"

# then identify the process by PID (replace <PID> with the returned number)
tasklist /FI "PID eq <PID>"

# kill process (if safe)
Stop-Process -Id <PID> -Force
# or use Services.msc to stop a Windows service
```

- Embedding blocked by headers (X-Frame-Options)

If the iframe displays an error like "Refused to display '...' in a frame because it set 'X-Frame-Options' to 'deny'", check:

- `grafana/grafana.ini` and the `GF_SECURITY_ALLOW_EMBEDDING=true` variable in `docker-compose.yml`.
- If there is a proxy in front of Grafana that injects `X-Frame-Options` or CSP. Remove/adjust this header in the proxy.

- Connection refused when loading the dashboard

- Confirm that the address/port in the iframe is correct (e.g., `http://localhost:3000/d/...`).
- If Grafana requires a login, log in in the same browser before using the viewer, or enable anonymous access as shown above.

## Useful Commands

```Powershell
# Start all services
docker compose up -d

# View Grafana logs
docker compose logs -f Grafana

# List containers
docker ps

# Stop and remove containers (cleanup)
docker compose down --volumes
```

## Development and Contributions

Pull requests are welcome. For dashboard contributions, add the JSON file to `grafana/dashboards/` and update the description in the PR.

## License

This project follows the license present in the repository (see `LICENSE`).