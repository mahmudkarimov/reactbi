# Local BI

Schema-first BI app prototype with ClickHouse previews, basic filtering and time bucketing, and PostgreSQL-backed saved charts.

## Requirements

- Docker Desktop with the Linux container engine running
- Node.js 22.12+ (Node 24 recommended)
- npm

## Start the local services

```powershell
docker compose up -d --build
docker compose ps
```

The first startup pulls the images and builds the API container. When the tables are empty, the API seeds `analytics.sales_orders` with 1,600 deterministic demo orders and `analytics.superset_sales` with the Apache Superset sample sales data. Existing rows are preserved. `sales_orders` includes enriched customer and product fields; `superset_sales` provides a more realistic order-line dataset with product lines, customer geography, deal size, and order dates. The Superset sample and its NOTICE are kept in `infra/clickhouse/seeds/`; the NOTICE identifies Open Government Licence v3.0 data. The API runs inside the Compose network so it can connect directly to both databases. Local endpoints:

- ClickHouse HTTP: `http://localhost:8123` (user `bi`, password `local-bi-password`)
- PostgreSQL: `localhost:5432` (database/user `local_bi`, password `local-bi-password`)
- API: `http://localhost:3001`

These credentials are for local development only. Do not reuse them outside this machine.

## Install and run the web app

```powershell
npm install
npm run dev:web
```

Open `http://localhost:5173`. The API listens on `http://localhost:3001`. In the chart builder, choose `superset_sales` to explore the imported sample; use `order_date` for time series and `sales` for revenue totals.

To stop the local services, run `docker compose down`. Add `-v` only when you intend to erase the local database volumes and saved chart data.

## Current API endpoints

- `GET /health`
- `GET /api/catalog`
- `GET /api/catalog/:table/columns`
- `GET /api/catalog/:table/columns/:column/values`
- `POST /api/query/preview` with a table, category, measure, time grain, optional categorical filter, and bounded row limit
- `GET /api/dashboards/overview`
- `POST /api/dashboards/overview/charts`
- `DELETE /api/dashboards/overview/charts/:chartId`

The chart preview runs against ClickHouse directly. The API validates fields against the selected table, parameterizes filter values, caps previews at 500 groups (the UI requests 100), and stores saved chart definitions in PostgreSQL.

## Try the first chart

Open the app and choose `sales_orders` for the richer sample, then adjust the category, value, or calculation in the chart builder. Choose a time grain for a date field, add a filter, switch between bar, line, and table previews, and customize the title, color theme, sort order, grid lines, and legend. Use **Save chart** to store the full chart definition on the Overview dashboard. Dashboard tiles refresh their data from ClickHouse when the Overview page loads; select a tile to edit its chart.
