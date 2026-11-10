# Architecture

## Product direction

Build a browser based BI tool where people connect a data source, choose a dataset, assemble a chart from fields, and place it on a dashboard. The first supported source is ClickHouse. DuckDB is an optional local or extracted data execution target; normal connected-source queries run in the source warehouse.

The first release is schema-first. Users can browse tables and columns and build charts without writing SQL. Saved SQL datasets can be added later using the same chart interface once their result columns can be inspected.

## Principles

- A chart is a portable definition of user intent, not SQL text.
- The server owns metadata access, authorization, query planning, dialect compilation, and execution.
- Start with table-backed datasets and a small set of explicit aggregations. Add semantic modeling only when real use cases require measures, joins, or reusable business definitions.
- Never silently guess a join or an aggregation that could change a result.
- Make query activity, loading, errors, and extract freshness understandable in the UI.
- Keep connector-specific behavior behind an adapter boundary.

## Initial stack

- **Web:** React, TypeScript, Vite; accessible controls; Apache ECharts behind an app-owned visualization adapter with chart modules loaded on demand.
- **API:** TypeScript on Node.js (Fastify), with runtime request validation and typed contracts shared with the web app.
- **Metadata and app state:** PostgreSQL for users, connections, saved chart definitions, dashboards, and minimal dataset metadata.
- **Warehouse:** ClickHouse for the first remote connector, accessed by the API using a read-only service identity.
- **Local/extract engine:** DuckDB in a separate execution adapter. Do not move large warehouse queries into DuckDB implicitly.
- **Development:** Docker Compose runs ClickHouse, PostgreSQL, and the API on a private service network; Vite serves the web app on the host. The API can reach both databases through Compose DNS names.

These choices are a starting point, not a requirement to overbuild. In particular, the query planner should begin small and only introduce abstractions justified by a second connector or richer query needs.

## System shape

```text
React app
  ├─ Dataset explorer and chart builder
  ├─ Dashboard viewer/editor
  └─ API client
       │ chart intent / metadata requests
       ▼
API service
  ├─ Auth and authorization
  ├─ Dataset catalog and connection service
  ├─ Query validation and planner
  ├─ SQL compiler ── ClickHouse dialect
  ├─ Execution and result normalization
  └─ Saved charts, dashboards, audit/observability
       │                           │
       ▼                           ▼
ClickHouse (remote)             PostgreSQL (app state)

Optional: DuckDB execution adapter for local files / explicit extracts
```

## Chart definition and query path

The client submits a structured chart specification, for example:

```json
{
  "datasetId": "orders",
  "dimensions": [{ "field": "created_at", "bucket": "month" }],
  "measures": [{ "field": "revenue", "aggregation": "sum", "label": "Revenue" }],
  "filters": [{ "field": "status", "op": "in", "value": ["paid"] }],
  "orderBy": [{ "field": "created_at", "direction": "asc" }],
  "limit": 500,
        "visualization": { "type": "line", "x": "created_at", "y": ["Revenue"] },
        "appearance": { "title": "Revenue by month", "palette": "sage", "showGrid": true, "showLegend": false }
}
```

The API validates every dataset and field against the catalog and the user's access, validates operators and value types, builds a small logical query plan, compiles parameterized SQL for the connector, enforces limits/timeouts, executes with cancellation support, and returns typed columns, rows, and query metadata. SQL identifiers must come from validated catalog metadata and be quoted by the dialect compiler; filter values are parameters. The UI never sends executable SQL in the normal chart flow.

For the initial version, the planner supports one table, selected dimensions, aggregate measures, filters, sorting, and row limits. Joins are not available until modeled explicitly. Unsupported combinations should produce actionable validation errors rather than approximate results.

## Schema-first catalog and lightweight metadata

On connection, the API introspects databases, tables, columns, types, and basic permissions. The user selects a table as a dataset. Store app-owned metadata separately from warehouse schema:

- Friendly dataset and field labels, descriptions, visibility, and default aggregation.
- Explicit field type overrides only where introspection is insufficient.
- Approved relationships when joins are introduced.
- Ownership and access policy references.

Do not require users to define a full semantic model for the first chart. However, the app should not infer that every numeric column is additive, nor infer joins from matching names. Offer sensible defaults and let users change aggregation. The metadata model can grow into a semantic layer without changing the chart definition contract.

## API surface

The local vertical slice currently exposes:

- `GET /api/catalog` and `GET /api/catalog/:table/columns` for table and field discovery.
- `GET /api/catalog/:table/columns/:column/values` for bounded categorical filter options.
- `POST /api/query/preview` for a validated chart intent with one optional categorical filter and an optional date bucket.
- `GET /api/dashboards/overview`, `POST /api/dashboards/overview/charts`, and `DELETE /api/dashboards/overview/charts/:chartId` for saved chart definitions.

Chart appearance options such as title, palette, sort order, grid lines, and legend visibility are stored in the chart definition. The local Compose API seeds `analytics.sales_orders` with deterministic demo data and imports the Apache Superset sample into `analytics.superset_sales` only when each table is empty. The Superset CSV and its source NOTICE live under `infra/clickhouse/seeds/`.

The broader multi-connection API will add:

- `POST /connections` and connection test/credential update operations.
- `GET /connections/:id/catalog` to browse databases, tables, and columns.
- `POST /datasets` and `GET /datasets/:id` for selected table datasets and app metadata.

Use versioned, validated JSON contracts. Do not expose credentials in API responses or logs. Keep query preview separate from saving a chart so exploration stays quick.

## Data and security boundaries

- Warehouse credentials are encrypted at rest and only decrypted by the API at query time; never sent back to the browser.
- Connect using read-only identities where supported. Apply per-user/tenant authorization before metadata access and query execution.
- Parameterize values, validate identifiers, cap result rows and execution time, and support cancellation.
- Audit who ran a query, against which connection/dataset, and its duration/outcome; avoid logging sensitive row data or secrets.
- Treat extracts as an explicit action with a visible source, creation time, refresh state, storage location, and retention policy.

## UX flow

1. Connect ClickHouse and test the connection.
2. Browse schema with searchable databases/tables/columns.
3. Select a table and open the chart builder.
4. Drag or select fields into X/dimensions, Y/measures, and filters. Show the chosen aggregation clearly.
5. Debounce edits and request a bounded preview; show loading, no-data, validation, and query-error states distinctly.
6. Choose a visualization, title it, save, and add it to a dashboard.

The current chart set is table, bar, line, area, pie, and donut. Add scatter and mixed-series combo charts when the chart definition and query planner support multiple metric and series field roles. Keep the field list and chart configuration visible together on desktop, with a responsive layout for narrower screens. Generated SQL can be available in an advanced inspection panel, but it is not required to build a chart.

## Suggested repository layout

```text
apps/
  web/                 React application
  api/                 HTTP API and orchestration
packages/
  contracts/           Shared request/response schemas and types
  query-core/          Chart spec validation, logical plan, result types
  dialect-clickhouse/  ClickHouse SQL compilation
  connector-clickhouse/ ClickHouse metadata and query execution
  connector-duckdb/    Optional local/extract execution
  ui/                  Shared visual components
infra/
  docker-compose.yml
  clickhouse/          Local seed/configuration
docs/
```

Keep packages modular in code, but deploy the initial product as a web app and one API service. Avoid microservices until operational needs justify them.

## Delivery milestones

1. **Foundation:** repository/tooling, local ClickHouse in Docker, sample dataset, API health check, connection test.
2. **Vertical slice:** inspect schema, choose a table, submit chart intent, execute safe ClickHouse SQL, render a table preview and one chart.
3. **MVP:** field browser, core chart types, filters and aggregations, saved charts, dashboards, helpful states, auth and access controls.
4. **Hardening:** cancellation/timeouts, query limits, caching, audit/metrics, credential handling, failure recovery, usability pass.
5. **Expansion:** explicit saved-SQL datasets, DuckDB local/extract workflows, then additional warehouse adapters based on demand.

## Decisions to revisit with evidence

- Whether the API remains TypeScript or a separate query service becomes useful.
- Whether a formal semantic model is needed for multi-table joins and shared business metrics.
- Which warehouse connector follows ClickHouse.
- Extract storage format, refresh policy, and tenancy model once extract workflows are in scope.

