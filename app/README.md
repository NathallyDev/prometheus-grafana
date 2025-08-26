This small Express server proxies a couple of Grafana and Prometheus APIs so a custom UI can fetch dashboards and metric results without exposing API tokens to the browser.

Setup

- copy `.env.example` to `.env` and set `GRAFANA_TOKEN` if your Grafana requires an API token.
- install dependencies and run:

```bash
cd app
npm install
npm start
```

Endpoints

- GET /api/dashboard/:uid — returns Grafana dashboard JSON (requires GRAFANA_TOKEN if secured)
- GET /api/query?q=<promql> — executes instant PromQL query against Prometheus and returns results

Additional endpoints (reporting & rendering)

- GET /api/query_range?q=<promql>&start=<unix>&end=<unix>&step=<s> — runs a Prometheus range query
- POST /api/snapshot { dashboardUid, name? } — creates a Grafana snapshot (server-side)
- GET /api/render-panel?uid=<uid>&panelId=<id>&from=<from>&to=<to>&width=800&height=600 — returns PNG image of a panel
