import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyReply } from 'fastify';
import { createClient } from '@clickhouse/client';
import { Pool } from 'pg';

const app = Fastify({ logger: true });
const database = process.env.CLICKHOUSE_DATABASE ?? 'analytics';
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'bi',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'local-bi-password',
  database,
});
const appDb = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://local_bi:local-bi-password@localhost:5432/local_bi' });

type Column = { name: string; type: string; position: number };
type Aggregation = 'sum' | 'avg' | 'min' | 'max' | 'count';
type DateBucket = 'none' | 'day' | 'week' | 'month' | 'year';
type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'combo' | 'heatmap' | 'table';
type AggregatedField = { field: string; aggregation: Aggregation };
type ChartSpecV2 = {
  version: 2;
  table: string;
  encodings: {
    x: { field: string; fields?: string[]; dateBucket: DateBucket };
    y: AggregatedField[];
    yCategories?: string[];
    series?: { field: string; fields?: string[] };
  };
  sortBy: 'dimension' | 'value';
  chartType: ChartType;
  filter?: { field: string; value: string };
  displayTitle?: string;
  valueFormat?: 'number' | 'currency' | 'percent';
  currencyCode?: 'USD' | 'SGD' | 'EUR' | 'GBP';
  palette?: 'sage' | 'ocean' | 'sunset' | 'berry';
  showGrid?: boolean;
  showLegend?: boolean;
};
type LegacyChartSpec = {
  table: string; dimension: string; measure: string; aggregation: Aggregation;
  sortBy: 'dimension' | 'value'; chartType: ChartType; dateBucket: DateBucket;
  filterField: string; filterValue: string; displayTitle?: string;
  valueFormat?: ChartSpecV2['valueFormat']; currencyCode?: ChartSpecV2['currencyCode'];
  palette?: ChartSpecV2['palette']; showGrid?: boolean; showLegend?: boolean;
  seriesDimension?: string; additionalMeasures?: string[];
};
type ChartSpec = ChartSpecV2 | LegacyChartSpec;
type NormalizedSpec = {
  table: string; xDimensions: string[]; yDimensions: string[]; dateBucket: DateBucket;
  measures: AggregatedField[]; seriesDimensions: string[];
  sortBy: 'dimension' | 'value'; chartType: ChartType;
  filterField: string; filterValue: string;
};
type ChartPreviewRequest = ChartSpec & { limit: number };

const textField = { type: 'string', minLength: 1, maxLength: 255 };
const optionalTextField = { type: 'string', maxLength: 255 };
const legacyChartSpecSchema = {
  type: 'object', additionalProperties: false,
  required: ['table', 'dimension', 'measure', 'aggregation', 'sortBy', 'chartType', 'dateBucket', 'filterField', 'filterValue'],
  properties: {
    table: textField, dimension: textField, measure: textField,
    aggregation: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'] },
    sortBy: { type: 'string', enum: ['dimension', 'value'] },
    chartType: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'combo', 'heatmap', 'table'] },
    dateBucket: { type: 'string', enum: ['none', 'day', 'week', 'month', 'year'] },
    filterField: optionalTextField, filterValue: { type: 'string', maxLength: 500 },
    displayTitle: { type: 'string', maxLength: 100 },
    valueFormat: { type: 'string', enum: ['number', 'currency', 'percent'] },
    currencyCode: { type: 'string', enum: ['USD', 'SGD', 'EUR', 'GBP'] },
    palette: { type: 'string', enum: ['sage', 'ocean', 'sunset', 'berry'] },
    showGrid: { type: 'boolean' },
    showLegend: { type: 'boolean' },
    seriesDimension: optionalTextField,
    additionalMeasures: { type: 'array', maxItems: 4, items: textField },
  },
} as const;
const chartSpecV2Schema = {
  type: 'object', additionalProperties: false,
  required: ['version', 'table', 'encodings', 'sortBy', 'chartType'],
  properties: {
    version: { const: 2 }, table: textField,
    encodings: {
      type: 'object', additionalProperties: false, required: ['x', 'y'],
      properties: {
        x: {
          type: 'object', additionalProperties: false, required: ['field', 'dateBucket'],
          properties: { field: textField, fields: { type: 'array', items: textField }, dateBucket: { type: 'string', enum: ['none', 'day', 'week', 'month', 'year'] } },
        },
        y: { type: 'array', minItems: 1, maxItems: 5, items: {
          type: 'object', additionalProperties: false, required: ['field', 'aggregation'],
          properties: { field: textField, aggregation: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'] } },
        } },
        yCategories: { type: 'array', items: textField },
        series: { type: 'object', additionalProperties: false, required: ['field'], properties: { field: textField, fields: { type: 'array', minItems: 1, items: textField } } },
      },
    },
    sortBy: { type: 'string', enum: ['dimension', 'value'] },
    chartType: { type: 'string', enum: ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'combo', 'heatmap', 'table'] },
    filter: { type: 'object', additionalProperties: false, required: ['field', 'value'], properties: { field: textField, value: { type: 'string', maxLength: 500 } } },
    displayTitle: { type: 'string', maxLength: 100 },
    valueFormat: { type: 'string', enum: ['number', 'currency', 'percent'] },
    currencyCode: { type: 'string', enum: ['USD', 'SGD', 'EUR', 'GBP'] },
    palette: { type: 'string', enum: ['sage', 'ocean', 'sunset', 'berry'] },
    showGrid: { type: 'boolean' }, showLegend: { type: 'boolean' },
  },
} as const;
const chartSpecSchema = { anyOf: [chartSpecV2Schema, legacyChartSpecSchema] } as const;

await appDb.query(`
  CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS saved_charts (
    id TEXT PRIMARY KEY,
    dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    chart_spec JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS saved_charts_dashboard_created_idx ON saved_charts(dashboard_id, created_at);
`);
await appDb.query("INSERT INTO dashboards (id, name) VALUES ('overview', 'Overview') ON CONFLICT (id) DO NOTHING");
if (process.env.SEED_DEMO_DATA === 'true') await ensureDemoSalesData();
if (process.env.SEED_DEMO_DATA === 'true') await ensureSupersetSalesData();

app.get('/health', async () => ({ status: 'ok' }));

app.get('/api/catalog', async (_request, reply) => {
  try {
    const result = await clickhouse.query({
      query: 'SELECT name FROM system.tables WHERE database = {database:String} AND is_temporary = 0 ORDER BY name',
      query_params: { database },
      format: 'JSONEachRow',
    });
    return await result.json<{ name: string }>();
  } catch (error) {
    return serviceUnavailable(reply, error, 'Could not read the ClickHouse catalog.');
  }
});

app.get<{ Params: { table: string } }>('/api/catalog/:table/columns', {
  schema: { params: { type: 'object', required: ['table'], properties: { table: textField } } },
}, async (request, reply) => {
  try {
    const columns = await getColumns(request.params.table);
    if (!columns.length) return reply.code(404).send({ error: 'Table not found in this database.' });
    return columns;
  } catch (error) {
    return serviceUnavailable(reply, error, 'Could not read the table columns.');
  }
});

app.get<{ Params: { table: string; column: string } }>('/api/catalog/:table/columns/:column/values', {
  schema: { params: { type: 'object', required: ['table', 'column'], properties: { table: textField, column: textField } } },
}, async (request, reply) => {
  try {
    const columns = await getColumns(request.params.table);
    const column = columns.find((item) => item.name === request.params.column);
    if (!column) return reply.code(404).send({ error: 'Field not found in this table.' });
    const identifier = quoteIdentifier(column.name);
    const result = await clickhouse.query({
      query: `SELECT DISTINCT toString(${identifier}) AS value FROM ${quoteIdentifier(database)}.${quoteIdentifier(request.params.table)} WHERE ${identifier} IS NOT NULL ORDER BY value ASC LIMIT 100`,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 10 },
    });
    return await result.json<{ value: string }>();
  } catch (error) {
    return serviceUnavailable(reply, error, 'Could not load the available filter values.');
  }
});

app.get('/api/dashboards/overview', async (_request, reply) => {
  try {
    const { rows } = await appDb.query(
      'SELECT id, title, chart_spec AS "chartSpec", created_at AS "createdAt" FROM saved_charts WHERE dashboard_id = $1 ORDER BY created_at DESC',
      ['overview'],
    );
    return { id: 'overview', name: 'Overview', charts: rows };
  } catch (error) {
    return serviceUnavailable(reply, error, 'Could not load the dashboard.');
  }
});

app.post<{ Body: { title: string; chartSpec: ChartSpec } }>('/api/dashboards/overview/charts', {
  schema: {
    body: {
      type: 'object', additionalProperties: false, required: ['title', 'chartSpec'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100 },
        chartSpec: chartSpecSchema,
      },
    },
  },
}, async (request, reply) => {
  try {
    const { title, chartSpec } = request.body;
    const normalized = normalizeChartSpec(chartSpec);
    const columns = await getColumns(normalized.table);
    const requiredFields = [...normalized.xDimensions, ...normalized.yDimensions, ...normalized.measures.map(({ field }) => field), ...normalized.seriesDimensions].filter(Boolean);
    if (requiredFields.some((field) => !columns.some((column) => column.name === field))) {
      return reply.code(400).send({ error: 'The chart uses fields that are no longer available.' });
    }
    const storedSpec = upgradeChartSpec(chartSpec);
    const id = randomUUID();
    const { rows } = await appDb.query(
      'INSERT INTO saved_charts (id, dashboard_id, title, chart_spec) VALUES ($1, $2, $3, $4) RETURNING id, title, chart_spec AS "chartSpec", created_at AS "createdAt"',
      [id, 'overview', title.trim(), storedSpec],
    );
    return reply.code(201).send(rows[0]);
  } catch (error) {
    return serviceUnavailable(reply, error, 'Could not save this chart.');
  }
});

app.put<{ Params: { chartId: string }; Body: { title: string; chartSpec: ChartSpec } }>('/api/dashboards/overview/charts/:chartId', {
  schema: {
    params: { type: 'object', required: ['chartId'], properties: { chartId: { type: 'string', format: 'uuid' } } },
    body: {
      type: 'object', additionalProperties: false, required: ['title', 'chartSpec'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100 },
        chartSpec: chartSpecSchema,
      },
    },
  },
}, async (request, reply) => {
  try {
    const { title, chartSpec } = request.body;
    const normalized = normalizeChartSpec(chartSpec);
    const columns = await getColumns(normalized.table);
    const requiredFields = [...normalized.xDimensions, ...normalized.yDimensions, ...normalized.measures.map(({ field }) => field), ...normalized.seriesDimensions].filter(Boolean);
    if (requiredFields.some((field) => !columns.some((column) => column.name === field))) {
      return reply.code(400).send({ error: 'The chart uses fields that are no longer available.' });
    }
    const storedSpec = upgradeChartSpec(chartSpec);
    const { rows } = await appDb.query(
      'UPDATE saved_charts SET title = $1, chart_spec = $2 WHERE id = $3 AND dashboard_id = $4 RETURNING id, title, chart_spec AS "chartSpec", created_at AS "createdAt"',
      [title.trim(), storedSpec, request.params.chartId, 'overview'],
    );
    if (!rows.length) return reply.code(404).send({ error: 'Saved chart not found.' });
    return reply.send(rows[0]);
  } catch (error) {
    return serviceUnavailable(reply, error, 'Could not update this chart.');
  }
});

app.delete<{ Params: { chartId: string } }>('/api/dashboards/overview/charts/:chartId', {
  schema: { params: { type: 'object', required: ['chartId'], properties: { chartId: { type: 'string', format: 'uuid' } } } },
}, async (request, reply) => {
  try {
    const result = await appDb.query('DELETE FROM saved_charts WHERE id = $1 AND dashboard_id = $2', [request.params.chartId, 'overview']);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Saved chart not found.' });
    return reply.code(204).send();
  } catch (error) {
    return serviceUnavailable(reply, error, 'Could not delete this chart.');
  }
});

app.post<{ Body: ChartPreviewRequest }>('/api/query/preview', {
  schema: {
    body: {
      type: 'object', additionalProperties: false,
      properties: { ...legacyChartSpecSchema.properties, ...chartSpecV2Schema.properties, limit: { type: 'integer', minimum: 1, maximum: 500 } },
      required: ['limit'],
      anyOf: [
        { required: [...legacyChartSpecSchema.required] },
        { required: [...chartSpecV2Schema.required] },
      ],
    },
  },
}, async (request, reply) => {
  try {
    const { limit } = request.body;
    const spec = normalizeChartSpec(request.body);
    const { table, xDimensions, yDimensions, measures, seriesDimensions, sortBy, chartType, dateBucket, filterField, filterValue } = spec;
    const columns = await getColumns(table);
    if (!columns.length) return reply.code(404).send({ error: 'Table not found in this database.' });
    const xDimensionColumns = xDimensions.map((field) => columns.find((column) => column.name === field));
    const yDimensionColumns = yDimensions.map((field) => columns.find((column) => column.name === field));
    const dimensionColumns = [...xDimensionColumns, ...yDimensionColumns];
    const measureColumns = measures.map(({ field }) => columns.find((column) => column.name === field));
    const seriesColumns = seriesDimensions.map((field) => columns.find((column) => column.name === field));
    if (!dimensionColumns.length || dimensionColumns.some((column) => !column) || measureColumns.some((column) => !column) || seriesColumns.some((column) => !column)) {
      return reply.code(400).send({ error: 'Choose chart fields from the selected table.' });
    }
    if (measures.some((metric, index) => metric.aggregation !== 'count' && !isNumericType(measureColumns[index]!.type))) {
      return reply.code(400).send({ error: 'Each metric must be numeric unless its calculation is Count rows.' });
    }
    if (xDimensions.length > 0 && yDimensions.length > 0 && chartType !== 'heatmap' && chartType !== 'table') {
      return reply.code(400).send({ error: 'Two category axes need a heatmap or table chart.' });
    }
    if (chartType === 'scatter' && (xDimensions.length !== 1 || yDimensions.length > 0 || !isNumericType(xDimensionColumns[0]!.type))) return reply.code(400).send({ error: 'Scatter charts need one numeric field on the X-axis and numeric Y metrics.' });
    if (chartType === 'combo' && measures.length < 2) return reply.code(400).send({ error: 'Combo charts need at least two metrics on the Y-axis.' });
    if ((chartType === 'pie' || chartType === 'donut') && (measures.length > 1 || seriesColumns.length || (xDimensions.length > 0 && yDimensions.length > 0))) {
      return reply.code(400).send({ error: 'Pie and donut charts use one metric and one category field.' });
    }
    if (seriesColumns.some((column) => /^(Array|Map|Tuple|Nested|Object|JSON)/.test(column!.type))) {
      return reply.code(400).send({ error: 'Breakdown fields must be scalar values.' });
    }
    if (dateBucket !== 'none' && !dimensionColumns.some((column) => isDateType(column!.type))) {
      return reply.code(400).send({ error: 'Date grouping is only available for date and timestamp fields on the X-axis.' });
    }
    if (Boolean(filterField) !== Boolean(filterValue)) return reply.code(400).send({ error: 'Choose both a filter field and a filter value.' });
    const filterColumn = filterField ? columns.find((column) => column.name === filterField) : undefined;
    if (filterField && !filterColumn) return reply.code(400).send({ error: 'Choose a filter field from the selected table.' });

    const xDimensionExpressions = xDimensionColumns.map((column) => dateDimensionExpression(column!, isDateType(column!.type) ? dateBucket : 'none'));
    const yDimensionExpressions = yDimensionColumns.map((column) => dateDimensionExpression(column!, isDateType(column!.type) ? dateBucket : 'none'));
    const labelExpression = (expressions: string[]) => expressions.length === 1 ? expressions[0] : expressions.length ? `concat(${expressions.map((expression) => `toString(${expression})`).join(", ' · ', ")})` : "''";
    const xLabelSql = labelExpression(xDimensionExpressions);
    const yLabelSql = labelExpression(yDimensionExpressions);
    const dimensionSql = xDimensionExpressions.length ? xLabelSql : yLabelSql;
    const dimensionFieldSelects = [
      ...xDimensionExpressions.map((expression, index) => `toString(${expression}) AS ${quoteIdentifier(`x_dimension_${index}`)}`),
      ...yDimensionExpressions.map((expression, index) => `toString(${expression}) AS ${quoteIdentifier(`y_dimension_${index}`)}`),
    ];
    const dimensionFieldSelectSql = dimensionFieldSelects.length ? `, ${dimensionFieldSelects.join(', ')}` : '';
    const seriesExpressions = seriesColumns.map((column) => quoteIdentifier(column!.name));
    const seriesSql = seriesExpressions.length === 1 ? seriesExpressions[0] : seriesExpressions.length ? `concat(${seriesExpressions.map((expression) => `toString(${expression})`).join(", ' · ', ")})` : '';
    const metricAliases = measures.map((_, index) => measures.length === 1 ? 'value' : `metric_${index}`);
    const aggregates = measures.map((metric, index) => {
      const expression = metric.aggregation === 'count' ? 'count()' : `${metric.aggregation}(${quoteIdentifier(measureColumns[index]!.name)})`;
      return `${expression} AS ${quoteIdentifier(metricAliases[index])}`;
    });
    const order = sortBy === 'dimension' ? 'dimension ASC' : `${quoteIdentifier(metricAliases[0])} DESC`;
    const filterSql = filterColumn ? ` WHERE toString(${quoteIdentifier(filterColumn.name)}) = {filterValue:String}` : '';
    const selectSeries = seriesColumns.length ? `, ${seriesSql} AS series` : '';
    const groupExpressions = [...xDimensionExpressions, ...yDimensionExpressions, ...seriesExpressions];
    const groupBy = groupExpressions.length ? ` GROUP BY ${groupExpressions.join(', ')}` : '';
    const seriesOrder = seriesColumns.length ? ', series ASC' : '';
    const query = `SELECT ${dimensionSql} AS dimension, ${xLabelSql} AS x_dimension, ${yLabelSql} AS y_dimension${dimensionFieldSelectSql}${selectSeries}, ${aggregates.join(', ')} FROM ${quoteIdentifier(database)}.${quoteIdentifier(table)}${filterSql}${groupBy} ORDER BY ${order}${seriesOrder} LIMIT {rowLimit:UInt32}`;
    const result = await clickhouse.query({
      query,
      query_params: { rowLimit: limit, ...(filterColumn ? { filterValue } : {}) },
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 20 },
    });
    const rows = await result.json<Record<string, string | number>>();
    return { columns: ['dimension', 'x_dimension', 'y_dimension', ...dimensionFieldSelects.map((_, index) => index < xDimensions.length ? `x_dimension_${index}` : `y_dimension_${index - xDimensions.length}`), ...(seriesColumns.length ? ['series'] : []), ...metricAliases], rows, rowCount: rows.length, truncated: rows.length === limit, measures };
  } catch (error) {
    return serviceUnavailable(reply, error, 'The preview query could not be completed.');
  }
});

async function getColumns(table: string) {
  const result = await clickhouse.query({
    query: 'SELECT name, type, position FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
    query_params: { database, table },
    format: 'JSONEachRow',
  });
  return result.json<Column>();
}

function normalizeChartSpec(spec: ChartSpec): NormalizedSpec {
  if ('version' in spec && spec.version === 2) {
    const xFields = spec.encodings.x.fields ?? [spec.encodings.x.field];
    const yCategories = spec.encodings.yCategories ?? [];
    const explicitSeries = spec.encodings.series?.fields ?? (spec.encodings.series?.field ? [spec.encodings.series.field] : []);
    return {
      table: spec.table,
      xDimensions: xFields,
      yDimensions: yCategories,
      dateBucket: spec.encodings.x.dateBucket,
      measures: spec.encodings.y,
      seriesDimensions: explicitSeries,
      sortBy: spec.sortBy,
      chartType: spec.chartType,
      filterField: spec.filter?.field ?? '',
      filterValue: spec.filter?.value ?? '',
    };
  }
  const legacy = spec as LegacyChartSpec;
  return {
    table: legacy.table,
    xDimensions: [legacy.dimension],
    yDimensions: [],
    dateBucket: legacy.dateBucket,
    measures: [{ field: legacy.measure, aggregation: legacy.aggregation }, ...(legacy.additionalMeasures ?? []).map((field) => ({ field, aggregation: legacy.aggregation }))],
    seriesDimensions: legacy.seriesDimension ? [legacy.seriesDimension] : [],
    sortBy: legacy.sortBy,
    chartType: legacy.chartType,
    filterField: legacy.filterField,
    filterValue: legacy.filterValue,
  };
}

function upgradeChartSpec(spec: ChartSpec): ChartSpecV2 {
  if ('version' in spec && spec.version === 2) return spec;
  const legacy = spec as LegacyChartSpec;
  return {
    version: 2,
    table: legacy.table,
    encodings: {
      x: { field: legacy.dimension, dateBucket: legacy.dateBucket },
      y: [{ field: legacy.measure, aggregation: legacy.aggregation }, ...(legacy.additionalMeasures ?? []).map((field) => ({ field, aggregation: legacy.aggregation }))],
      ...(legacy.seriesDimension ? { series: { field: legacy.seriesDimension } } : {}),
    },
    sortBy: legacy.sortBy,
    chartType: legacy.chartType,
    ...(legacy.filterField ? { filter: { field: legacy.filterField, value: legacy.filterValue } } : {}),
    displayTitle: legacy.displayTitle,
    valueFormat: legacy.valueFormat,
    currencyCode: legacy.currencyCode,
    palette: legacy.palette,
    showGrid: legacy.showGrid,
    showLegend: legacy.showLegend,
  };
}

async function ensureDemoSalesData() {
  const migration = await readFile(new URL('../../../infra/clickhouse/migrations/002_sales_orders.sql', import.meta.url), 'utf8');
  await clickhouse.command({ query: migration });
  const result = await clickhouse.query({ query: 'SELECT count() AS row_count FROM analytics.sales_orders', format: 'JSONEachRow' });
  const [count] = await result.json<{ row_count: string | number }>();
  if (Number(count?.row_count ?? 0) > 0) return;
  const seed = await readFile(new URL('../../../infra/clickhouse/seeds/002_sales_orders.sql', import.meta.url), 'utf8');
  await clickhouse.command({ query: seed });
  app.log.info('Seeded 1,600 enriched demo sales orders');
}

async function ensureSupersetSalesData() {
  const migration = await readFile(new URL('../../../infra/clickhouse/migrations/003_superset_sales.sql', import.meta.url), 'utf8');
  await clickhouse.command({ query: migration });
  const result = await clickhouse.query({ query: 'SELECT count() AS row_count FROM analytics.superset_sales', format: 'JSONEachRow' });
  const [count] = await result.json<{ row_count: string | number }>();
  if (Number(count?.row_count ?? 0) > 0) return;

  const csv = await readFile(new URL('../../../infra/clickhouse/seeds/superset_sales.csv', import.meta.url), 'utf8');
  const records = parseCsv(csv);
  const [headers, ...lines] = records;
  if (!headers || lines.length === 0) throw new Error('The Superset sales sample is empty or malformed.');
  const rows = lines.map((line) => {
    const values = Object.fromEntries(headers.map((header, index) => [header, line[index] ?? '']));
    const [month, day, year] = values.order_date.split('/').map(Number);
    if (!month || !day || !year) throw new Error(`Invalid order_date in Superset sales sample: ${values.order_date}`);
    return {
      order_number: Number(values.order_number),
      quantity_ordered: Number(values.quantity_ordered),
      price_each: Number(values.price_each),
      order_line_number: Number(values.order_line_number),
      sales: Number(values.sales),
      order_date: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
      status: values.status,
      quarter: Number(values.quarter),
      month: Number(values.month),
      year: Number(values.year),
      product_line: values.product_line,
      msrp: Number(values.msrp),
      product_code: values.product_code,
      customer_name: values.customer_name,
      phone: values.phone,
      address_line1: values.address_line1,
      address_line2: values.address_line2,
      city: values.city,
      state: values.state,
      postal_code: values.postal_code,
      country: values.country,
      territory: values.territory,
      contact_last_name: values.contact_last_name,
      contact_first_name: values.contact_first_name,
      deal_size: values.deal_size,
    };
  });
  await clickhouse.insert({ table: 'superset_sales', values: rows, format: 'JSONEachRow' });
  app.log.info({ rowCount: rows.length }, 'Seeded Apache Superset sample sales data');
}

function parseCsv(text: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''));
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('The Superset sales sample contains an unterminated CSV field.');
  if (record.length > 0 || field.length > 0) {
    record.push(field.replace(/\r$/, ''));
    if (record.some((value) => value.length > 0)) records.push(record);
  }
  return records;
}

function isNumericType(type: string) {
  return /^(U?Int|Float|Decimal|Nullable\((U?Int|Float|Decimal))/.test(type);
}

function isString(type: string) { return /String/.test(type); }

function isDateType(type: string) {
  return /Date/.test(type);
}

function dateDimensionExpression(column: Column, bucket: DateBucket) {
  const identifier = quoteIdentifier(column.name);
  if (bucket === 'none') return identifier;
  if (!isDateType(column.type)) throw new Error('Date buckets require a date field.');
  const functions: Record<Exclude<DateBucket, 'none'>, string> = {
    day: 'toStartOfDay', week: 'toStartOfWeek', month: 'toStartOfMonth', year: 'toStartOfYear',
  };
  return `${functions[bucket]}(${identifier})`;
}

function quoteIdentifier(value: string) {
  if (value.length < 1 || value.length > 255 || /[\u0000-\u001f]/.test(value)) throw new Error('Unexpected identifier in catalog metadata.');
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`')}\``;
}

function serviceUnavailable(reply: FastifyReply, error: unknown, message: string) {
  app.log.error({ err: error }, message);
  return reply.code(503).send({ error: message });
}

app.addHook('onClose', async () => {
  await Promise.all([clickhouse.close(), appDb.end()]);
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ host: '0.0.0.0', port });
