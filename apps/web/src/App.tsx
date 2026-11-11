import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import type { CellContext, ColumnDef, SortingState } from '@tanstack/react-table';
import {
  BarChart3, BookOpen, ChartArea, ChartColumn, ChartLine, ChartNoAxesCombined, ChartPie, ChartScatter,
  ChevronDown, ChevronLeft, Copy, Database, Donut, Download, Grid2X2, Home, LayoutDashboard, LoaderCircle,
  Search, Table2, Trash2, WandSparkles,
} from 'lucide-react';
import type { EChartType } from './charting/EChartView';
import { fieldLabel, formatAxisLabel, formatValue, type ValueFormat } from './charting/format';

const EChartView = lazy(() => import('./charting/EChartView').then(({ EChartView: component }) => ({ default: component })));

type Dataset = { name: string };
type Column = { name: string; type: string; position: number };
type Aggregation = 'sum' | 'avg' | 'min' | 'max' | 'count';
type ChartType = EChartType | 'heatmap' | 'table';
type DateBucket = 'none' | 'day' | 'week' | 'month' | 'year';
type PaletteName = 'sage' | 'ocean' | 'sunset' | 'berry';
type PreviewRow = { [key: string]: string | number | undefined; dimension: string | number; x_dimension?: string | number; y_dimension?: string | number; series?: string | number; value?: string | number; metric_0?: string | number; metric_1?: string | number; metric_2?: string | number; metric_3?: string | number; metric_4?: string | number };
type ChartRow = { dimension: string; xDimension?: string; yDimension?: string; xDimensions?: string[]; yDimensions?: string[]; series?: string; values: number[] };
type LegacyChartSpec = {
  table: string; dimension: string; measure: string; aggregation: Aggregation;
  sortBy: 'dimension' | 'value'; chartType: ChartType; dateBucket: DateBucket;
  filterField: string; filterValue: string;
  displayTitle?: string; valueFormat?: ValueFormat; currencyCode?: 'USD' | 'SGD' | 'EUR' | 'GBP';
  palette?: PaletteName; showGrid?: boolean; showLegend?: boolean; showDataLabels?: boolean; smoothLines?: boolean; stackSeries?: boolean;
  seriesDimension?: string; additionalMeasures?: string[]; alternateYCategories?: string[];
};
type ChartSpec = { version: 2; table: string; encodings: { x: { field: string; fields?: string[]; dateBucket: DateBucket }; y: { field: string; aggregation: Aggregation }[]; yCategories?: string[]; series?: { field: string; fields?: string[] } }; sortBy: 'dimension' | 'value'; sortField?: string; chartType: ChartType; filter?: { field: string; value?: string; values?: string[] }; displayTitle?: string; valueFormat?: ValueFormat; currencyCode?: 'USD' | 'SGD' | 'EUR' | 'GBP'; palette?: PaletteName; showGrid?: boolean; showLegend?: boolean; showDataLabels?: boolean; smoothLines?: boolean; stackSeries?: boolean; alternateYCategories?: string[] } | LegacyChartSpec;
type SavedChart = { id: string; title: string; chartSpec: ChartSpec; createdAt: string };

const PALETTES: Record<PaletteName, { label: string; colors: string[] }> = {
  sage: { label: 'ECharts default', colors: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'] },
  ocean: { label: 'Ocean', colors: ['#397ca5', '#65a9bd', '#275a7e', '#94c8cf', '#e3a96f'] },
  sunset: { label: 'Sunset', colors: ['#d47752', '#e7a05b', '#ad574b', '#efc477', '#8e7466'] },
  berry: { label: 'Berry', colors: ['#8d638e', '#c07ba0', '#5d587f', '#dda1a4', '#b58d65'] },
};
type HomePage = 'overview' | 'dashboards' | 'browse' | 'data';
type DashboardPreview = { state: 'loading' | 'ready' | 'error'; rows: ChartRow[] };

function isNumeric(type: string) {
  return /^(U?Int|Float|Decimal|Nullable\((U?Int|Float|Decimal))/.test(type);
}
function isDate(type: string) { return /Date/.test(type); }
function isString(type: string) { return /String/.test(type); }
function isComplex(type: string) { return /^(Array|Map|Tuple|Nested|Object|JSON)/.test(type); }
function acceptedDropEffect(dataTransfer: DataTransfer): 'copy' | 'move' {
  return dataTransfer.effectAllowed === 'move' || dataTransfer.effectAllowed === 'linkMove' ? 'move' : 'copy';
}
function normalizeSpec(spec: ChartSpec) {
  if ('version' in spec && spec.version === 2) return spec;
  const legacy = spec as LegacyChartSpec;
  return { version: 2 as const, table: legacy.table, encodings: { x: { field: legacy.dimension, dateBucket: legacy.dateBucket }, y: [{ field: legacy.measure, aggregation: legacy.aggregation }, ...(legacy.additionalMeasures ?? []).map((field) => ({ field, aggregation: legacy.aggregation }))], ...(legacy.seriesDimension ? { series: { field: legacy.seriesDimension } } : {}) }, sortBy: legacy.sortBy, sortField: legacy.measure, chartType: legacy.chartType, ...(legacy.filterField ? { filter: { field: legacy.filterField, value: legacy.filterValue } } : {}), displayTitle: legacy.displayTitle, valueFormat: legacy.valueFormat, currencyCode: legacy.currencyCode, palette: legacy.palette, showGrid: legacy.showGrid, showLegend: legacy.showLegend, showDataLabels: legacy.showDataLabels, smoothLines: legacy.smoothLines, stackSeries: legacy.stackSeries, alternateYCategories: legacy.alternateYCategories };
}
function canonicalChartSpec(spec: ChartSpec) {
  const normalized = normalizeSpec(spec);
  const x = normalized.encodings.x;
  const series = normalized.encodings.series;
  return JSON.stringify({
    version: 2,
    table: normalized.table,
    encodings: {
      x: { field: x.field, fields: x.fields ?? [x.field], dateBucket: x.dateBucket },
      y: normalized.encodings.y,
      yCategories: normalized.encodings.yCategories ?? [],
      series: series ? { field: series.field, fields: series.fields ?? [series.field] } : null,
    },
    sortBy: normalized.sortBy,
    sortField: normalized.sortField ?? normalized.encodings.y[0]?.field ?? '',
    chartType: normalized.chartType,
    filter: normalized.filter ? { field: normalized.filter.field, values: normalized.filter.values ?? (normalized.filter.value ? [normalized.filter.value] : []) } : null,
    displayTitle: normalized.displayTitle ?? '',
    valueFormat: normalized.valueFormat ?? 'number',
    currencyCode: normalized.currencyCode ?? 'USD',
    palette: normalized.palette ?? 'sage',
    showGrid: normalized.showGrid ?? true,
    showLegend: normalized.showLegend ?? false,
    showDataLabels: normalized.showDataLabels ?? false,
    smoothLines: normalized.smoothLines ?? true,
    stackSeries: normalized.stackSeries ?? true,
    alternateYCategories: normalized.alternateYCategories ?? [],
  });
}
function mapRows(rows: PreviewRow[], metricCount: number): ChartRow[] {
  const dimensionValues = (row: PreviewRow, axis: 'x' | 'y', fallback: string) => {
    const fields = Object.keys(row).filter((key) => new RegExp(`^${axis}_dimension_\\d+$`).test(key)).sort((left, right) => Number(left.slice(axis.length + 11)) - Number(right.slice(axis.length + 11)));
    return fields.length ? fields.map((key) => String(row[key] ?? '')) : [fallback];
  };
  return rows.map((row) => ({
    dimension: String(row.dimension), xDimension: String(row.x_dimension ?? row.dimension), yDimension: String(row.y_dimension ?? ''),
    xDimensions: dimensionValues(row, 'x', String(row.x_dimension ?? row.dimension)),
    yDimensions: dimensionValues(row, 'y', String(row.y_dimension ?? '')),
    ...(row.series !== undefined ? { series: String(row.series) } : {}),
    values: Array.from({ length: metricCount }, (_, index) => Number(metricCount === 1 ? row.value ?? row.metric_0 : row[`metric_${index}`] ?? 0)),
  }));
}

type ReportMeasure = { field: string; aggregation: Aggregation };
type ReportTableDatum = { id: string; breakdown?: string; [key: string]: string | number | undefined };
type ReportTableProps = {
  rows: ChartRow[]; xFields: string[]; yFields: string[]; seriesFields: string[];
  measures: ReportMeasure[]; colors: string[]; valueFormat: ValueFormat; currencyCode: string;
  onDimensionDragStart: (field: string) => void; onDimensionDragEnd: () => void;
  onDimensionDrop: (field: string, targetField: string, targetAxis: 'x' | 'y', position: 'before' | 'after') => void;
};

function ReportDataTable({ rows, xFields, yFields, seriesFields, measures, colors, valueFormat, currencyCode, onDimensionDragStart, onDimensionDragEnd, onDimensionDrop }: ReportTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [dropMarker, setDropMarker] = useState('');
  const dropCommitted = useRef(false);
  const finishTableDrag = (draggedField: string) => {
    if (!dropCommitted.current && dropMarker && draggedField) {
      const axis = dropMarker.startsWith('x:') ? 'x' : 'y';
      const targetField = dropMarker.slice(2, dropMarker.lastIndexOf(':'));
      const position = dropMarker.endsWith(':after') ? 'after' : 'before';
      if (targetField) onDimensionDrop(draggedField, targetField, axis, position);
    }
    dropCommitted.current = false;
    setDropMarker('');
    onDimensionDragEnd();
  };
  const grouped = xFields.length > 0 && yFields.length > 0;
  const breakdownValues = [...new Set(rows.map((row) => row.series ?? '').filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const breakdownColor = (value?: string) => value ? colors[Math.max(0, breakdownValues.indexOf(value)) % colors.length] : undefined;
  const data = useMemo<ReportTableDatum[]>(() => {
    if (grouped) {
      const compareTuple = (left: string[], right: string[]) => left.join('\u0000').localeCompare(right.join('\u0000'));
      const xTuples = [...new Map(rows.map((row) => { const tuple = row.xDimensions ?? [row.xDimension ?? row.dimension]; return [JSON.stringify(tuple), tuple] as const; })).values()].sort(compareTuple);
      const yGroups = [...new Map(rows.map((row) => { const dimensions = row.yDimensions ?? [row.yDimension ?? '']; const series = row.series ?? ''; return [JSON.stringify([dimensions, series]), { dimensions, series }] as const; })).values()].sort((left, right) => compareTuple(left.dimensions, right.dimensions) || left.series.localeCompare(right.series));
      const cells = new Map(rows.map((row) => [JSON.stringify([row.xDimensions ?? [row.xDimension ?? row.dimension], row.yDimensions ?? [row.yDimension ?? ''], row.series ?? '']), row.values]));
      return yGroups.map((group) => {
        const datum: ReportTableDatum = { id: JSON.stringify([group.dimensions, group.series]), breakdown: group.series };
        yFields.forEach((_, index) => { datum[`row_${index}`] = group.dimensions[index] ?? ''; });
        xTuples.forEach((tuple, columnIndex) => {
          const values = cells.get(JSON.stringify([tuple, group.dimensions, group.series]));
          measures.forEach((_, metricIndex) => { datum[`value_${columnIndex}_${metricIndex}`] = values?.[metricIndex]; });
        });
        measures.forEach((_, metricIndex) => {
          const values = xTuples.map((_, columnIndex) => datum[`value_${columnIndex}_${metricIndex}`]).filter((value): value is number => typeof value === 'number');
          const aggregation = measures[metricIndex].aggregation;
          datum[`row_total_${metricIndex}`] = !values.length || aggregation === 'avg' ? undefined
            : aggregation === 'min' ? Math.min(...values)
              : aggregation === 'max' ? Math.max(...values)
                : values.reduce((total, value) => total + value, 0);
        });
        return datum;
      });
    }
    const dimensionFields = xFields.length ? xFields : yFields;
    return rows.map((row, rowIndex) => {
      const dimensions = xFields.length ? row.xDimensions ?? [row.xDimension ?? row.dimension] : row.yDimensions ?? [row.yDimension ?? row.dimension];
      const datum: ReportTableDatum = { id: `${row.dimension}-${row.series ?? ''}-${rowIndex}`, breakdown: row.series };
      dimensionFields.forEach((_, index) => { datum[`row_${index}`] = dimensions[index] ?? ''; });
      if (seriesFields.length) datum.breakdown = row.series ?? '';
      measures.forEach((_, metricIndex) => { datum[`value_${metricIndex}`] = row.values[metricIndex]; });
      return datum;
    });
  }, [grouped, measures, rows, seriesFields.length, xFields, yFields]);

  const columns = useMemo<ColumnDef<ReportTableDatum>[]>(() => {
    const dimensionFields = grouped ? yFields : xFields.length ? xFields : yFields;
    const columnsForRows: ColumnDef<ReportTableDatum>[] = dimensionFields.map((field, index) => ({ id: `row_${index}`, accessorFn: (row) => row[`row_${index}`], header: fieldLabel(field), meta: { axisField: field }, cell: (context) => String(context.getValue() ?? '—') }));
    if (grouped && seriesFields.length) columnsForRows.push({ id: 'breakdown', accessorFn: (row) => row.breakdown, header: seriesFields.map(fieldLabel).join(' · '), cell: (context) => String(context.getValue() ?? '—') });
    if (grouped) {
      type HeaderNode = { label: string; children: HeaderNode[]; columnIndexes: number[] };
      const xTuples = [...new Map(rows.map((row) => { const tuple = row.xDimensions ?? [row.xDimension ?? row.dimension]; return [JSON.stringify(tuple), tuple] as const; })).values()].sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')));
      const roots: HeaderNode[] = [];
      xTuples.forEach((tuple, columnIndex) => {
        let siblings = roots;
        tuple.forEach((label, level) => {
          let node = siblings.find((candidate) => candidate.label === label);
          if (!node) { node = { label, children: [], columnIndexes: [] }; siblings.push(node); }
          node.columnIndexes.push(columnIndex);
          siblings = node.children;
          if (level === tuple.length - 1) node.children = [];
        });
      });
      const buildHeaderColumns = (nodes: HeaderNode[], level: number, prefix: string): ColumnDef<ReportTableDatum>[] => nodes.map((node) => ({
        id: `x_${prefix}_${level}_${node.label}`,
        header: node.label,
        meta: { axisField: xFields[level] },
        ...(level === xFields.length - 1
          ? { columns: node.columnIndexes.flatMap((columnIndex) => measures.map((measure, metricIndex) => ({
            id: `value_${columnIndex}_${metricIndex}`,
            accessorFn: (row: ReportTableDatum) => row[`value_${columnIndex}_${metricIndex}`],
            header: metricLabel(measure),
            cell: (context: CellContext<ReportTableDatum, unknown>) => renderMeasureCell(context.getValue(), context.row.original.breakdown, measure, breakdownColor, valueFormat, currencyCode),
          }))) }
          : { columns: buildHeaderColumns(node.children, level + 1, `${prefix}_${node.label}`) }),
      }));
      const rowTotals: ColumnDef<ReportTableDatum> = {
        id: 'row_totals', header: 'Row total', columns: measures.map((measure, metricIndex) => ({
          id: `row_total_${metricIndex}`,
          accessorFn: (row) => row[`row_total_${metricIndex}`],
          header: metricLabel(measure),
          cell: (context: CellContext<ReportTableDatum, unknown>) => renderMeasureCell(context.getValue(), undefined, measure, breakdownColor, valueFormat, currencyCode),
        })),
      };
      return [...columnsForRows, ...buildHeaderColumns(roots, 0, 'root'), rowTotals];
    }
    return [...columnsForRows, ...(seriesFields.length ? [{ id: 'breakdown', accessorFn: (row: ReportTableDatum) => row.breakdown, header: seriesFields.map(fieldLabel).join(' · '), cell: (context: CellContext<ReportTableDatum, unknown>) => String(context.getValue() ?? '—') } as ColumnDef<ReportTableDatum>] : []), ...measures.map((measure, metricIndex) => ({
      id: `value_${metricIndex}`,
      accessorFn: (row: ReportTableDatum) => row[`value_${metricIndex}`],
      header: metricLabel(measure),
      cell: (context: CellContext<ReportTableDatum, unknown>) => renderMeasureCell(context.getValue(), context.row.original.breakdown, measure, breakdownColor, valueFormat, currencyCode),
    }))];
  }, [breakdownValues, colors, currencyCode, grouped, measures, rows, seriesFields, valueFormat, xFields, yFields]);

  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 25 } } });
  const visibleRows = table.getRowModel().rows.length;
  const totalRows = table.getPrePaginationRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const grandTotals = useMemo<ReportTableDatum | null>(() => {
    if (!grouped || !data.length) return null;
    const totals: ReportTableDatum = { id: 'grand-total', row_0: 'Grand total' };
    const valueKeys = Object.keys(data[0]).filter((key) => /^value_\d+_\d+$/.test(key) || /^row_total_\d+$/.test(key));
    valueKeys.forEach((key) => {
      const values = data.map((row) => row[key]).filter((value): value is number => typeof value === 'number');
      const metricIndex = key.startsWith('row_total_') ? Number(key.slice('row_total_'.length)) : Number(key.slice(key.lastIndexOf('_') + 1));
      const aggregation = measures[metricIndex]?.aggregation;
      totals[key] = !values.length || aggregation === 'avg' ? undefined
        : aggregation === 'min' ? Math.min(...values)
          : aggregation === 'max' ? Math.max(...values)
            : values.reduce((sum, value) => sum + value, 0);
    });
    return totals;
  }, [data, grouped, measures]);
  return <div className="result-table-wrap">
    {grouped && <div className="cross-tab-caption">Columns: {xFields.map(fieldLabel).join(' › ')}</div>}
    <div className="result-table-scroll" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDragEnd={() => setDropMarker('')} onDropCapture={(event) => { event.preventDefault(); event.stopPropagation(); const target = (event.target as Element).closest<HTMLElement>('[data-axis-field][data-axis]'); const field = event.dataTransfer.getData('application/x-fieldnote-field') || event.dataTransfer.getData('text/plain'); if (!target || !field) return; const axis = target.dataset.axis as 'x' | 'y'; const rect = target.getBoundingClientRect(); const position = axis === 'x' ? event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' : event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'; dropCommitted.current = true; onDimensionDrop(field, target.dataset.axisField!, axis, position); setDropMarker(''); }}><table className="result-table"><thead>{table.getHeaderGroups().map((group) => <tr key={group.id}>{group.headers.map((header) => {
      const axisField = (header.column.columnDef.meta as { axisField?: string } | undefined)?.axisField;
      const isColumnDimension = Boolean(axisField && xFields.includes(axisField));
      const handleTargetDrop = (event: ReactDragEvent<HTMLElement>) => {
        event.preventDefault(); event.stopPropagation();
        const field = event.dataTransfer.getData('application/x-fieldnote-field') || event.dataTransfer.getData('text/plain');
        if (!field || !axisField) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const position = isColumnDimension ? event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' : event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
        onDimensionDrop(field, axisField, isColumnDimension ? 'x' : 'y', position);
        setDropMarker('');
      };
      const updateHeaderMarker = (event: ReactDragEvent<HTMLElement>) => {
        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
        if (!axisField || !isColumnDimension) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setDropMarker(`x:${axisField}:${event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'}`);
      };
      const startDrag = (event: ReactDragEvent<HTMLElement>) => {
        if (!axisField) return;
        dropCommitted.current = false;
        event.dataTransfer.setData('application/x-fieldnote-field', axisField);
        event.dataTransfer.setData('text/plain', axisField);
        event.dataTransfer.effectAllowed = 'move';
        onDimensionDragStart(axisField);
      };
      const headerSide = dropMarker.startsWith(`x:${axisField}:`) ? (dropMarker.endsWith(':before') ? 'before' : 'after') : '';
      return <th key={header.id} colSpan={header.colSpan} draggable={Boolean(axisField)} data-axis-field={axisField} data-axis={isColumnDimension ? 'x' : axisField ? 'y' : undefined} data-drop-position={headerSide} className={headerSide ? `dimension-drop-${headerSide} dimension-drop-column` : undefined} title={axisField ? `Drag ${fieldLabel(axisField)}; drop ${isColumnDimension ? 'above or below this column group' : 'left or right of this row dimension'}` : undefined} onDragStart={startDrag} onDragEnd={() => axisField ? finishTableDrag(axisField) : onDimensionDragEnd()} onDragOver={axisField ? updateHeaderMarker : undefined} onDrop={axisField ? handleTargetDrop : undefined} aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
        {header.isPlaceholder ? null : <>{header.column.getCanSort() ? <button className="table-sort-button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() && <span>{header.column.getIsSorted() === 'asc' ? '↑' : '↓'}</span>}</button> : flexRender(header.column.columnDef.header, header.getContext())}</>}
      </th>;
    })}</tr>)}</thead><tbody>{table.getRowModel().rows.map((row) => {return <tr key={row.id}>{row.getVisibleCells().map((cell) => { const axisField = (cell.column.columnDef.meta as { axisField?: string } | undefined)?.axisField; const isRowDimension = Boolean(axisField && yFields.includes(axisField)); const updateRowMarker = (event: ReactDragEvent<HTMLTableCellElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (!axisField) return; const rect = event.currentTarget.getBoundingClientRect(); const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'; setDropMarker(`y:${axisField}:${side}`); event.currentTarget.dataset.dropPosition = side; }; const markerSide = dropMarker.startsWith(`y:${axisField}:`) ? (dropMarker.endsWith(':before') ? 'before' : 'after') : ''; return <td key={cell.id} data-axis-field={isRowDimension ? axisField : undefined} data-axis={isRowDimension ? 'y' : undefined} data-drop-position={markerSide} className={markerSide ? `dimension-drop-${markerSide} dimension-drop-row` : undefined} onDragOver={isRowDimension ? updateRowMarker : undefined} onDrop={isRowDimension ? (event) => { event.preventDefault(); event.stopPropagation(); if (!axisField) return; const field = event.dataTransfer.getData('application/x-fieldnote-field') || event.dataTransfer.getData('text/plain'); if (!field) return; const rect = event.currentTarget.getBoundingClientRect(); onDimensionDrop(field, axisField, 'y', event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'); setDropMarker(''); } : undefined}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;})}</tr>;})}{grandTotals && <tr className="table-grand-total">{table.getVisibleLeafColumns().map((column) => {
      if (column.id === 'row_0') return <th key={column.id} scope="row">Grand total</th>;
      if (column.id.startsWith('row_') || column.id === 'breakdown') return <td key={column.id} />;
      const totalValue = grandTotals[column.id];
      if (typeof totalValue !== 'number') return <td key={column.id}>—</td>;
      const metricIndex = column.id.startsWith('row_total_') ? Number(column.id.slice('row_total_'.length)) : Number(column.id.slice(column.id.lastIndexOf('_') + 1));
      const metric = measures[metricIndex];
      return <td key={column.id}>{metric ? renderMeasureCell(totalValue, undefined, metric, breakdownColor, valueFormat, currencyCode) : '—'}</td>;
    })}</tr>}</tbody></table></div>
    <div className="table-pagination"><span>{totalRows ? `${pageIndex * pageSize + 1}–${pageIndex * pageSize + visibleRows} of ${totalRows}` : '0 rows'}</span><label>Rows <select value={pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>‹</button><button aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>›</button></div>
  </div>;
}

function metricLabel(measure: ReportMeasure) { return measure.aggregation === 'count' ? 'Rows' : `${measure.aggregation[0].toUpperCase()}${measure.aggregation.slice(1)} · ${fieldLabel(measure.field)}`; }
function renderMeasureCell(value: unknown, breakdown: string | undefined, measure: ReportMeasure, colorFor: (value?: string) => string | undefined, valueFormat: ValueFormat, currencyCode: string) {
  if (value === undefined) return '—';
  const color = colorFor(breakdown);
  return <span className="table-value" style={color ? { color, backgroundColor: `${color}18` } : undefined}>{formatValue(Number(value), measure.aggregation === 'count' ? 'number' : valueFormat, currencyCode)}</span>;
}

export default function App() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [connectionState, setConnectionState] = useState<'loading' | 'connected' | 'error'>('loading');
  const [datasetSearch, setDatasetSearch] = useState('');
  const [chartSearch, setChartSearch] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [editorPanelTab, setEditorPanelTab] = useState<'build' | 'format'>('build');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [pendingFieldRole, setPendingFieldRole] = useState<'x' | 'y' | 'values' | 'series' | 'filter' | null>(null);
  const [homePage, setHomePage] = useState<HomePage>('overview');
  const [editorReturnPage, setEditorReturnPage] = useState<HomePage>('overview');
  const [selectedTable, setSelectedTable] = useState('');
  const [columns, setColumns] = useState<Column[]>([]);
  const [columnState, setColumnState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [dimension, setDimension] = useState('');
  const [additionalDimensions, setAdditionalDimensions] = useState<string[]>([]);
  const [yCategories, setYCategories] = useState<string[]>([]);
  const [alternateYCategories, setAlternateYCategories] = useState<string[]>([]);
  const [measure, setMeasure] = useState('');
  const [additionalMeasures, setAdditionalMeasures] = useState<string[]>([]);
  const [seriesDimension, setSeriesDimension] = useState('');
  const [additionalSeriesDimensions, setAdditionalSeriesDimensions] = useState<string[]>([]);
  const [dragField, setDragField] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const [dropError, setDropError] = useState('');
  const [layoutUndo, setLayoutUndo] = useState<{ x: string[]; y: string[] } | null>(null);
  const [layoutNotice, setLayoutNotice] = useState('');
  const [axisPillDropMarker, setAxisPillDropMarker] = useState('');
  const [aggregation, setAggregation] = useState<Aggregation>('sum');
  const [metricAggregations, setMetricAggregations] = useState<Record<string, Aggregation>>({});
  const [sortBy, setSortBy] = useState<'dimension' | 'value'>('value');
  const [sortField, setSortField] = useState('');
  const [displayTitle, setDisplayTitle] = useState('');
  const [valueFormat, setValueFormat] = useState<ValueFormat>('number');
  const [currencyCode, setCurrencyCode] = useState<'USD' | 'SGD' | 'EUR' | 'GBP'>('USD');
  const [palette, setPalette] = useState<PaletteName>('sage');
  const [showGrid, setShowGrid] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showDataLabels, setShowDataLabels] = useState(false);
  const [smoothLines, setSmoothLines] = useState(true);
  const [stackSeries, setStackSeries] = useState(true);
  const [dateBucket, setDateBucket] = useState<DateBucket>('none');
  const [filterField, setFilterField] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [filterValues, setFilterValues] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<string[]>([]);
  const [filterError, setFilterError] = useState('');
  const [chartType, setChartType] = useState<ChartType>('table');
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [duplicatingChartId, setDuplicatingChartId] = useState<string | null>(null);
  const [dashboardNotice, setDashboardNotice] = useState('');
  const [activeChartId, setActiveChartId] = useState<string | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<string | null>(null);
  const [dashboardPreviews, setDashboardPreviews] = useState<Record<string, DashboardPreview>>({});
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const pendingChart = useRef<SavedChart | null>(null);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [previewRows, setPreviewRows] = useState<ChartRow[]>([]);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    fetch('/api/catalog')
      .then((response) => {
        if (!response.ok) throw new Error('Catalog unavailable');
        return response.json() as Promise<Dataset[]>;
      })
      .then((tables) => { setDatasets(tables); setConnectionState('connected'); })
      .catch(() => setConnectionState('error'));
  }, []);

  useEffect(() => {
    fetch('/api/dashboards/overview')
      .then((response) => {
        if (!response.ok) throw new Error('Dashboard unavailable');
        return response.json() as Promise<{ charts: SavedChart[] }>;
      })
      .then((dashboard) => setSavedCharts(dashboard.charts))
      .catch(() => setSavedCharts([]))
      .finally(() => setDashboardLoaded(true));
  }, []);

  useEffect(() => {
    if (!savedCharts.length) { setDashboardPreviews({}); return; }
    const controller = new AbortController();
    setDashboardPreviews(Object.fromEntries(savedCharts.map((chart) => [chart.id, { state: 'loading', rows: [] }])));
    Promise.all(savedCharts.map(async (chart) => {
      try {
        const response = await fetch('/api/query/preview', {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ ...normalizeSpec(chart.chartSpec), alternateYCategories: undefined, limit: 100 }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Preview unavailable');
        return [chart.id, { state: 'ready' as const, rows: mapRows(payload.rows as PreviewRow[], normalizeSpec(chart.chartSpec).encodings.y.length) }] as const;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        return [chart.id, { state: 'error' as const, rows: [] }] as const;
      }
    })).then((results) => {
      if (!controller.signal.aborted) setDashboardPreviews(Object.fromEntries(results.filter((result): result is NonNullable<typeof result> => result !== null)));
    });
    return () => controller.abort();
  }, [savedCharts]);

  useEffect(() => {
    if (!selectedTable) return;
    const controller = new AbortController();
    setColumnState('loading');
    setColumns([]);
    setLayoutUndo(null); setLayoutNotice('');
    fetch(`/api/catalog/${encodeURIComponent(selectedTable)}/columns`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('We could not load this table’s fields. Try returning to data and opening it again.');
        return response.json() as Promise<Column[]>;
      })
      .then((tableColumns) => {
        setColumns(tableColumns);
        setColumnState('ready');
        const numeric = tableColumns.filter((column) => isNumeric(column.type));
        const measureColumn = numeric.find((column) => /revenue|sales|amount|total|value|price/i.test(column.name))
          ?? numeric.find((column) => !/(^id$|_id$)/i.test(column.name))
          ?? numeric[0];
        const category = tableColumns.find((column) => isString(column.type))
          ?? tableColumns.find((column) => isDate(column.type))
          ?? tableColumns.find((column) => !isNumeric(column.type))
          ?? tableColumns[0];
        const rawSaved = pendingChart.current?.chartSpec.table === selectedTable ? pendingChart.current.chartSpec : null;
        const saved = rawSaved ? normalizeSpec(rawSaved) : null;
        const firstMetric = saved?.encodings.y[0];
        const savedDimensions = saved?.encodings.x.fields ?? (saved?.encodings.x.field ? [saved.encodings.x.field] : []);
        const savedSeries = saved?.encodings.series?.fields ?? (saved?.encodings.series?.field ? [saved.encodings.series.field] : []);
        const savedYCategories = saved?.encodings.yCategories ?? [];
        setDimension(savedDimensions[0] ?? (savedYCategories.length ? '' : category?.name ?? ''));
        setAdditionalDimensions(savedDimensions.slice(1));
        setYCategories(savedYCategories);
        setAlternateYCategories(saved?.alternateYCategories ?? []);
        setMeasure(firstMetric?.field ?? measureColumn?.name ?? tableColumns[0]?.name ?? '');
        setAdditionalMeasures(saved?.encodings.y.slice(1).map((metric) => metric.field) ?? []);
        setSeriesDimension(savedSeries[0] ?? '');
        setAdditionalSeriesDimensions(savedSeries.slice(1));
        setAggregation(firstMetric?.aggregation ?? (measureColumn ? 'sum' : 'count'));
        setMetricAggregations(Object.fromEntries((saved?.encodings.y ?? []).map((metric) => [metric.field, metric.aggregation])));
        const savedChartType = saved?.chartType ?? 'table';
        const initialChartType = savedChartType;
        setDateBucket(saved?.encodings.x.dateBucket ?? (category && isDate(category.type) ? 'month' : 'none'));
        setSortBy(saved?.sortBy ?? (initialChartType === 'line' || initialChartType === 'area' ? 'dimension' : 'value'));
        setSortField(saved?.sortField ?? firstMetric?.field ?? '');
        setDisplayTitle(saved?.displayTitle ?? '');
        setValueFormat(saved?.valueFormat ?? 'number');
        setCurrencyCode(saved?.currencyCode ?? 'USD');
        setPalette(saved?.palette ?? 'sage');
        setShowGrid(saved?.showGrid ?? true);
        setShowLegend(saved?.showLegend ?? false);
        setShowDataLabels(saved?.showDataLabels ?? false);
        setSmoothLines(saved?.smoothLines ?? true);
        setStackSeries(saved?.stackSeries ?? true);
        setChartType(initialChartType);
        setFilterField(saved?.filter?.field ?? '');
        setFilterValue(saved?.filter?.value ?? '');
        setFilterValues(saved?.filter?.values ?? (saved?.filter?.value ? [saved.filter.value] : []));
        if (saved) pendingChart.current = null;
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setColumnState('error');
      });
    return () => controller.abort();
  }, [selectedTable]);

  useEffect(() => {
    if (!selectedTable || !filterField) { setFilterOptions([]); return; }
    const controller = new AbortController();
    setFilterOptions([]);
    setFilterError('');
    fetch(`/api/catalog/${encodeURIComponent(selectedTable)}/columns/${encodeURIComponent(filterField)}/values`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load values for this filter.');
        return response.json() as Promise<{ value: string }[]>;
      })
      .then((items) => setFilterOptions(items.map((item) => item.value)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFilterError(error instanceof Error ? error.message : 'Could not load filter values.');
      });
    return () => controller.abort();
  }, [selectedTable, filterField]);

  useEffect(() => {
    if (!selectedTable || (!dimension && !additionalDimensions.length && !yCategories.length) || (!measure && aggregation !== 'count') || columnState !== 'ready') return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreviewState('loading');
      setPreviewError('');
      fetch('/api/query/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ version: 2, table: selectedTable, encodings: { x: { field: dimension || yCategories[0], fields: dimensionFields, dateBucket: isDateDimension ? dateBucket : 'none' }, y: (measure || additionalMeasures.length ? [measure, ...additionalMeasures].filter(Boolean) : aggregation === 'count' ? [dimension || yCategories[0]] : []).map((field) => ({ field, aggregation: metricFields.includes(field) ? metricAggregations[field] ?? aggregation : aggregation })), ...(yCategories.length ? { yCategories } : {}), ...(seriesFields.length ? { series: { field: seriesFields[0], fields: seriesFields } } : {}) }, sortBy, sortField: metricFields.includes(sortField) ? sortField : metricFields[0] ?? '', chartType, ...(activeFilterValues.length ? { filter: { field: filterField, values: activeFilterValues } } : {}), displayTitle: chartTitle.slice(0, 100), valueFormat, currencyCode, palette, showGrid, showLegend, limit: 100 }),
      })
        .then(async (response) => {
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error ?? 'The preview could not be loaded.');
          return payload as { rows: PreviewRow[]; truncated: boolean };
        })
        .then((payload) => {
          setPreviewRows(mapRows(payload.rows, Math.max(1, 1 + additionalMeasures.length)));
          setPreviewTruncated(payload.truncated);
          setPreviewState('ready');
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setPreviewError(error instanceof Error ? error.message : 'The preview could not be loaded.');
          setPreviewState('error');
        });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [selectedTable, dimension, additionalDimensions, yCategories, measure, additionalMeasures, seriesDimension, additionalSeriesDimensions, aggregation, metricAggregations, sortBy, sortField, chartType, dateBucket, filterField, filterValue, filterValues, columnState]);

  const visibleDatasets = useMemo(
    () => datasets.filter(({ name }) => name.toLowerCase().includes(datasetSearch.toLowerCase())),
    [datasets, datasetSearch],
  );
  const visibleSavedCharts = useMemo(() => homePage === 'browse' ? savedCharts.filter((chart) => `${chart.title} ${chart.chartSpec.table} ${chart.chartSpec.chartType}`.toLowerCase().includes(chartSearch.toLowerCase())) : savedCharts, [chartSearch, homePage, savedCharts]);
  const numericColumns = columns.filter((column) => isNumeric(column.type));
  const metricFields = [measure, ...additionalMeasures].filter(Boolean);
  const dimensionFields = [dimension, ...additionalDimensions].filter(Boolean);
  const seriesFields = [seriesDimension, ...additionalSeriesDimensions].filter(Boolean);
  const axisFields = dimensionFields.length ? dimensionFields : yCategories;
  const activeDimension = dimension || yCategories[0] || '';
  const isHorizontalBar = chartType === 'bar' && dimensionFields.length === 0 && yCategories.length > 0;
  const isCrossTab = dimensionFields.length > 0 && yCategories.length > 0;
  const chartMeasures = metricFields.length ? metricFields : aggregation === 'count' && activeDimension ? [activeDimension] : [];
  const metricAggregation = (field: string) => metricFields.includes(field) ? metricAggregations[field] ?? (isNumeric(columns.find((column) => column.name === field)?.type ?? '') ? aggregation : 'count') : aggregation;
  const isDateDimension = axisFields.some((field) => isDate(columns.find((column) => column.name === field)?.type ?? ''));
  const filterableColumns = [...columns.filter((column) => isString(column.type)), ...columns.filter((column) => isDate(column.type))];
  const activeFilterValues = filterValues.length ? filterValues : filterValue ? [filterValue] : [];
  const bucketLabel = dateBucket === 'none' ? '' : ` (${dateBucket === 'day' ? 'daily' : dateBucket === 'week' ? 'weekly' : dateBucket === 'month' ? 'monthly' : 'yearly'})`;
  const titleAggregation = metricAggregation(chartMeasures[0] ?? '');
  const automaticTitle = titleAggregation === 'count'
    ? `Count rows by ${fieldLabel(activeDimension || 'category')}${isDateDimension ? bucketLabel : ''}`
    : `${titleAggregation[0].toUpperCase()}${titleAggregation.slice(1)} of ${fieldLabel(chartMeasures[0] || 'value')} by ${fieldLabel(activeDimension || 'category')}${isDateDimension ? bucketLabel : ''}`;
  const chartTitle = displayTitle.trim() || automaticTitle;
  const selectedPalette = PALETTES[palette];
  const chartValueFormat: ValueFormat = chartMeasures.length && chartMeasures.every((field) => metricAggregation(field) === 'count') ? 'number' : valueFormat;
  function chartSpec(): ChartSpec {
    return { version: 2, table: selectedTable, encodings: { x: { field: dimension || yCategories[0] || alternateYCategories[0] || '', fields: dimensionFields, dateBucket: isDateDimension ? dateBucket : 'none' }, y: chartMeasures.map((field) => ({ field, aggregation: metricAggregation(field) })), ...(yCategories.length ? { yCategories } : {}), ...(seriesFields.length ? { series: { field: seriesFields[0], fields: seriesFields } } : {}) }, sortBy, sortField: metricFields.includes(sortField) ? sortField : metricFields[0] ?? '', chartType, ...(activeFilterValues.length ? { filter: { field: filterField, values: activeFilterValues } } : {}), displayTitle: chartTitle.slice(0, 100), valueFormat, currencyCode, palette, showGrid, showLegend, showDataLabels, smoothLines, stackSeries, ...(alternateYCategories.length ? { alternateYCategories } : {}) };
  }
  function exportPreviewCsv() {
    const headers = [
      ...dimensionFields.map((field) => fieldLabel(field)),
      ...yCategories.map((field) => fieldLabel(field)),
      ...(seriesFields.length ? [seriesFields.map(fieldLabel).join(' / ')] : []),
      ...chartMeasures.map((field) => `${metricAggregation(field)} · ${fieldLabel(field)}`),
    ];
    const csvCell = (value: string | number | undefined) => {
      let text = value === undefined ? '' : String(value);
      if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(value)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const records = previewRows.map((row) => {
      const xValues = row.xDimensions ?? [row.xDimension ?? row.dimension];
      const yValues = yCategories.length ? row.yDimensions ?? [row.yDimension ?? ''] : [];
      return [
        ...dimensionFields.map((_, index) => xValues[index] ?? ''),
        ...yCategories.map((_, index) => yValues[index] ?? ''),
        ...(seriesFields.length ? [row.series ?? ''] : []),
        ...chartMeasures.map((_, index) => row.values[index]),
      ].map(csvCell).join(',');
    });
    const csv = `\uFEFF${[headers.map(csvCell).join(','), ...records].join('\r\n')}`;
    const filename = (chartTitle || selectedTable).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'report';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${filename}.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const hasUnsavedChanges = Boolean(activeChartId && savedBaseline && canonicalChartSpec(chartSpec()) !== savedBaseline);
  function confirmDiscardChanges() {
    return !hasUnsavedChanges || window.confirm('You have unsaved changes to this report. Leave without saving?');
  }
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  function changeChartType(nextType: ChartType) {
    setLayoutUndo(null); setLayoutNotice('');
    const leavingCrossTab = isCrossTab && nextType !== 'heatmap' && nextType !== 'table';
    const restoringCrossTab = (nextType === 'heatmap' || nextType === 'table') && !yCategories.length && alternateYCategories.length > 0;
    if (nextType === 'scatter') {
      if (numericColumns.length < 2) { setDropError('Scatter charts need two numeric fields: one for X and one for Y.'); return; }
      const currentXIsUsable = numericColumns.some((column) => column.name === dimension) && !metricFields.includes(dimension);
      const nextX = currentXIsUsable ? dimension : numericColumns.find((column) => column.name !== measure)?.name ?? numericColumns[0].name;
      const nextY = metricFields.find((field) => field !== nextX) ?? numericColumns.find((column) => column.name !== nextX)?.name ?? '';
      changeDimension(nextX);
      setAdditionalDimensions([]);
      setYCategories([]);
      setMeasure(nextY);
      setAdditionalMeasures([]);
    }
    if ((nextType === 'pie' || nextType === 'donut') && (additionalMeasures.length || seriesFields.length || (!leavingCrossTab && dimensionFields.length > 0 && yCategories.length > 0))) {
      setDropError('Remove extra metrics and the color breakdown before using pie or donut.');
      return;
    }
    if (leavingCrossTab) {
      setAlternateYCategories(yCategories);
      setYCategories([]);
      setLayoutNotice(`Switched to ${fieldLabel(nextType)}. Rows dimensions are saved and will return when you switch back to Table or Heatmap.`);
    } else if (restoringCrossTab) {
      setYCategories(alternateYCategories);
      setAlternateYCategories([]);
      setLayoutNotice('Restored the saved Rows dimensions.');
    }
    setDropError('');
    setChartType(nextType);
    setSortBy(nextType === 'line' || nextType === 'area' ? 'dimension' : 'value');
    if (nextType === 'pie' || nextType === 'donut') setShowLegend(true);
  }

  function changeDimension(value: string) {
    setDimension(value);
    const field = columns.find((column) => column.name === value);
    setDateBucket(field && isDate(field.type) ? 'month' : 'none');
  }

  function assignFieldToRole(fieldName: string, role: 'x' | 'y' | 'values' | 'series') {
    setLayoutUndo(null); setLayoutNotice('');
    const column = columns.find((item) => item.name === fieldName);
    if (!column) { setDropError('That field is no longer available.'); return false; }
    if (role === 'x') {
      if (yCategories.length && chartType !== 'table' && chartType !== 'heatmap') { setDropError('Choose Table or Heatmap before adding a second category axis.'); return false; }
      if (chartType === 'scatter' && !isNumeric(column.type)) { setDropError('Scatter charts need a numeric field on X.'); return false; }
      if (chartType === 'scatter' && (dimensionFields.length || metricFields.includes(column.name))) { setDropError('Scatter charts use one numeric X field, separate from Y.'); return false; }
      if ((chartType === 'pie' || chartType === 'donut') && yCategories.length) { setDropError('Remove the Y-axis categories before adding an X category to a pie chart.'); return false; }
      if (dimensionFields.includes(column.name)) { setDropError(`${fieldLabel(column.name)} is already on X.`); return false; }
      const remainingYDimensions = yCategories.filter((field) => field !== column.name);
      if (remainingYDimensions.length !== yCategories.length) removeYCategory(column.name);
      if (seriesFields.includes(column.name)) removeSeriesDimension(column.name);
      if (!dimension) changeDimension(column.name);
      else {
        setAdditionalDimensions((fields) => [...fields, column.name]);
        if (isDate(column.type)) setDateBucket((current) => current === 'none' ? 'month' : current);
      }
    } else if (role === 'y') {
      if (dimensionFields.length && chartType !== 'table' && chartType !== 'heatmap') { setDropError('Choose Table or Heatmap before adding a second category axis.'); return false; }
      if (isComplex(column.type)) { setDropError('Axis fields must be scalar values.'); return false; }
      if (chartType === 'scatter') { setDropError('Scatter Y uses a numeric measure. Drop it into Values.'); return false; }
      if ((chartType === 'pie' || chartType === 'donut') && dimensionFields.length) { setDropError('Pie and donut charts use one category axis. Remove X fields first.'); return false; }
      if (yCategories.includes(column.name)) { setDropError(`${fieldLabel(column.name)} is already on Y.`); return false; }
      if (dimensionFields.includes(column.name)) removeDimension(column.name);
      setYCategories((fields) => [...fields, column.name]);
    } else if (role === 'values') {
      if (isComplex(column.type)) { setDropError('Values must use scalar fields.'); return false; }
      if (metricFields.includes(column.name)) { setDropError(`${fieldLabel(column.name)} is already in Values.`); return false; }
      if (metricFields.length >= 5) { setDropError('A chart can compare up to five measures.'); return false; }
      setMetricAggregations((current) => ({ ...current, [column.name]: isNumeric(column.type) ? aggregation : 'count' }));
      if (!measure) setMeasure(column.name);
      else setAdditionalMeasures((items) => [...items, column.name]);
    } else {
      if (isComplex(column.type)) { setDropError('Breakdown fields must be scalar values.'); return false; }
      if (chartType === 'pie' || chartType === 'donut') { setDropError('Pie and donut charts do not support a color breakdown.'); return false; }
      if (dimensionFields.includes(column.name)) { setDropError('Choose a different field from X for the breakdown.'); return false; }
      if (seriesFields.includes(column.name)) { setDropError(`${fieldLabel(column.name)} is already assigned as a category.`); return false; }
      if (!seriesDimension) setSeriesDimension(column.name);
      else setAdditionalSeriesDimensions((fields) => [...fields, column.name]);
    }
    setDropError('');
    return true;
  }

  function positionDimension(field: string, targetField: string, targetAxis: 'x' | 'y', position: 'before' | 'after') {
    const column = columns.find((item) => item.name === field);
    if (!column || isNumeric(column.type) || isComplex(column.type)) { setDropError('Only categorical fields can be moved between table axes.'); return; }
    if (field === targetField) return;
    const previousX = [...dimensionFields];
    const previousY = [...yCategories];
    const nextX = previousX.filter((item) => item !== field);
    const nextY = previousY.filter((item) => item !== field);
    const destination = targetAxis === 'x' ? nextX : nextY;
    const targetIndex = destination.indexOf(targetField);
    if (targetIndex < 0) { setDropError('Could not find that table position. Try dropping beside a dimension value.'); return; }
    destination.splice(targetIndex + (position === 'after' ? 1 : 0), 0, field);
    if (previousX.length === nextX.length && previousY.length === nextY.length && previousX.every((item, index) => item === nextX[index]) && previousY.every((item, index) => item === nextY[index])) return;
    setLayoutUndo({ x: previousX, y: previousY });
    setDimension(nextX[0] ?? '');
    setAdditionalDimensions(nextX.slice(1));
    setYCategories(nextY);
    if (nextX.some((item) => isDate(columns.find((candidate) => candidate.name === item)?.type ?? ''))) setDateBucket((current) => current === 'none' ? 'month' : current);
    setLayoutNotice(`Moved ${fieldLabel(field)} to ${targetAxis === 'x' ? 'Columns' : 'Rows'} ${position} ${fieldLabel(targetField)}.`);
    setDropError('');
  }

  function undoDimensionMove() {
    if (!layoutUndo) return;
    setDimension(layoutUndo.x[0] ?? '');
    setAdditionalDimensions(layoutUndo.x.slice(1));
    setYCategories(layoutUndo.y);
    setLayoutUndo(null);
    setLayoutNotice('Last dimension move undone.');
    setDropError('');
  }

  function dropFieldOnChart(fieldName: string) {
    const column = columns.find((item) => item.name === fieldName);
    if (!column) { setDropError('That field is no longer available.'); return; }
    if (isNumeric(column.type)) {
      if (chartType === 'scatter' && !dimensionFields.length) assignFieldToRole(fieldName, 'x');
      else assignFieldToRole(fieldName, 'values');
    } else if (!dimensionFields.length) assignFieldToRole(fieldName, 'x');
    else if ((chartType === 'table' || chartType === 'heatmap') && !yCategories.length) assignFieldToRole(fieldName, 'y');
    else if (chartType === 'pie' || chartType === 'donut') assignFieldToRole(fieldName, 'x');
    else assignFieldToRole(fieldName, 'series');
  }

  function removeSeriesDimension(fieldName: string) {
    const next = seriesFields.filter((field) => field !== fieldName);
    setSeriesDimension(next[0] ?? '');
    setAdditionalSeriesDimensions(next.slice(1));
  }

  function removeDimension(fieldName: string) {
    setLayoutUndo(null); setLayoutNotice('');
    const next = dimensionFields.filter((field) => field !== fieldName);
    setDimension(next[0] ?? '');
    setAdditionalDimensions(next.slice(1));
    if (next.length) changeDimension(next[0]);
    else setDateBucket('none');
    if (next.some((field) => isDate(columns.find((column) => column.name === field)?.type ?? ''))) setDateBucket((current) => current === 'none' ? 'month' : current);
  }

  function removeYCategory(fieldName: string) {
    setLayoutUndo(null); setLayoutNotice('');
    const next = yCategories.filter((field) => field !== fieldName);
    setYCategories(next);
  }

  function removeMetric(fieldName: string) {
    const next = metricFields.filter((field) => field !== fieldName);
    setMeasure(next[0] ?? (aggregation === 'count' ? '' : numericColumns[0]?.name ?? ''));
    setAdditionalMeasures(next.slice(1));
    setMetricAggregations((current) => Object.fromEntries(Object.entries(current).filter(([field]) => field !== fieldName)));
  }

  function droppedField(event: ReactDragEvent<HTMLElement>) {
    return event.dataTransfer.getData('application/x-fieldnote-field') || event.dataTransfer.getData('text/plain') || dragField;
  }

  function renderAxisDimension(field: string, role: 'x' | 'y') {
    const markerPrefix = `${role}:${field}:`;
    const markerSide = axisPillDropMarker.startsWith(markerPrefix) ? axisPillDropMarker.slice(markerPrefix.length) : '';
    return <div key={`${role}-${field}`} draggable title={`Drag ${fieldLabel(field)} to reorder it or move it between Rows and Columns`} className={`field-pill ${role === 'y' ? 'field-pill-category' : ''} ${markerSide ? `field-pill-drop-${markerSide}` : ''}`} onDragStart={(event) => { event.dataTransfer.setData('application/x-fieldnote-field', field); event.dataTransfer.setData('text/plain', field); event.dataTransfer.effectAllowed = 'move'; setDragField(field); setDropError(''); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = acceptedDropEffect(event.dataTransfer); const rect = event.currentTarget.getBoundingClientRect(); setAxisPillDropMarker(`${role}:${field}:${event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'}`); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedField = droppedField(event); const rect = event.currentTarget.getBoundingClientRect(); if (draggedField) positionDimension(draggedField, field, role, event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'); setAxisPillDropMarker(''); setDragField(''); setDropTarget(''); }} onDragEnd={() => { setDragField(''); setDropTarget(''); setAxisPillDropMarker(''); }}><span className="field-pill-grip" aria-hidden="true">⠿</span><span>{fieldLabel(field)}</span>{role === 'y' && <small>DIMENSION</small>}{role === 'x' && isDate(columns.find((column) => column.name === field)?.type ?? '') && <select aria-label={`Time grain for ${fieldLabel(field)}`} value={dateBucket} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setDateBucket(event.target.value as DateBucket)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option><option value="none">Exact</option></select>}<button type="button" aria-label={`Remove ${fieldLabel(field)}`} onClick={() => role === 'x' ? removeDimension(field) : removeYCategory(field)}>×</button></div>;
  }

  function renderShelf(label: string, role: 'x' | 'y' | 'series' | 'filter', fields: string[], empty: string, enabled = true) {
    const assign = (field: string) => {
      if (role === 'filter') {
        if (!filterableColumns.some((column) => column.name === field)) { setDropError('Filters currently support text and date fields.'); return; }
        setFilterField(field); setFilterValue(''); setFilterValues([]); setDropError(''); return;
      }
      assignFieldToRole(field, role);
    };
    const remove = (field: string) => {
      if (role === 'x') removeDimension(field);
      else if (role === 'y') removeYCategory(field);
      else if (role === 'series') removeSeriesDimension(field);
      else { setFilterField(''); setFilterValue(''); setFilterValues([]); }
    };
    return <section className={`shelf ${enabled ? '' : 'shelf-disabled'}`} key={role}>
      <div className="shelf-heading"><span>{label}</span>{role === 'filter' && filterField ? <button onClick={() => remove(filterField)}>Clear</button> : <button disabled={!enabled} onClick={() => { if (enabled) setPendingFieldRole(role); }}>+ Add</button>}</div>
      <div role="group" aria-label={`${label} field slot`} className={`field-well shelf-well ${dropTarget === role || pendingFieldRole === role ? 'drop-active' : ''}`} onClick={() => { if (enabled && fields.length === 0) setPendingFieldRole(role); }} onDragOver={(event) => { if (!enabled) return; event.preventDefault(); event.dataTransfer.dropEffect = role === 'filter' ? 'copy' : acceptedDropEffect(event.dataTransfer); setDropTarget(role); }} onDragLeave={() => setDropTarget('')} onDrop={(event) => { event.preventDefault(); if (enabled) assign(droppedField(event)); setPendingFieldRole(null); setDragField(''); setDropTarget(''); }}>
        {!enabled ? <span className="field-well-empty">Available for Table and Heatmap</span> : role === 'x' ? (fields.length ? fields.map((field) => renderAxisDimension(field, 'x')) : <button className="field-well-empty-action" onClick={() => setPendingFieldRole(role)}>+ {empty}</button>) : role === 'y' ? (fields.length ? fields.map((field) => renderAxisDimension(field, 'y')) : <button className="field-well-empty-action" onClick={() => setPendingFieldRole(role)}>+ {empty}</button>) : role === 'series' ? (fields.length ? fields.map((field) => <button className="field-pill" key={field} onClick={() => remove(field)}>{fieldLabel(field)} <span>×</span></button>) : <button className="field-well-empty-action" onClick={() => setPendingFieldRole(role)}>+ {empty}</button>) : (filterField ? <button className="field-pill" onClick={() => remove(filterField)}>{fieldLabel(filterField)}{filterValues.length ? `: ${filterValues.length} selected` : ': All values'}<span>×</span></button> : <button className="field-well-empty-action" onClick={() => setPendingFieldRole(role)}>+ {empty}</button>)}
      </div>
    </section>;
  }

  async function saveChart() {
    const title = saveTitle.trim();
    if (!title) { setSaveError('Give this chart a name first.'); return; }
    setIsSaving(true);
    setSaveError('');
    try {
      const response = await fetch(activeChartId ? `/api/dashboards/overview/charts/${activeChartId}` : '/api/dashboards/overview/charts', {
        method: activeChartId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, chartSpec: chartSpec() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not save this chart.');
      const savedChart = payload as SavedChart;
      setActiveChartId(savedChart.id);
      setSavedBaseline(canonicalChartSpec(savedChart.chartSpec));
      setSavedCharts((current) => activeChartId ? current.map((chart) => chart.id === savedChart.id ? savedChart : chart) : [savedChart, ...current]);
      setIsSaveOpen(false);
      setSaveTitle(savedChart.title);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save this chart.');
    } finally { setIsSaving(false); }
  }

  function openSavedChart(chart: SavedChart) {
    if (!confirmDiscardChanges()) return;
    setEditorReturnPage(homePage);
    setActiveChartId(chart.id);
    setSavedBaseline(canonicalChartSpec(chart.chartSpec));
    setSaveTitle(chart.title);
    setLayoutUndo(null); setLayoutNotice('');
    setPreviewRows([]);
    setColumnState('loading');
    if (selectedTable === chart.chartSpec.table) {
      const spec = normalizeSpec(chart.chartSpec);
      const xFields = spec.encodings.x.fields ?? [spec.encodings.x.field];
      const colorFields = spec.encodings.series?.fields ?? (spec.encodings.series?.field ? [spec.encodings.series.field] : []);
      setDimension(xFields[0] ?? ''); setAdditionalDimensions(xFields.slice(1)); setYCategories(spec.encodings.yCategories ?? []); setAlternateYCategories(spec.alternateYCategories ?? []); setMeasure(spec.encodings.y[0]?.field ?? ''); setAdditionalMeasures(spec.encodings.y.slice(1).map((metric) => metric.field)); setSeriesDimension(colorFields[0] ?? ''); setAdditionalSeriesDimensions(colorFields.slice(1)); setAggregation(spec.encodings.y[0]?.aggregation ?? 'count'); setMetricAggregations(Object.fromEntries(spec.encodings.y.map((metric) => [metric.field, metric.aggregation]))); setSortBy(spec.sortBy); setSortField(spec.sortField ?? spec.encodings.y[0]?.field ?? '');
      setDateBucket(spec.encodings.x.dateBucket); setChartType(spec.chartType);
      setDisplayTitle(spec.displayTitle ?? ''); setPalette(spec.palette ?? 'sage');
      setValueFormat(spec.valueFormat ?? 'number'); setCurrencyCode(spec.currencyCode ?? 'USD');
      setShowGrid(spec.showGrid ?? true); setShowLegend(spec.showLegend ?? false);
      setShowDataLabels(spec.showDataLabels ?? false);
      setSmoothLines(spec.smoothLines ?? true);
      setStackSeries(spec.stackSeries ?? true);
      setFilterField(spec.filter?.field ?? ''); setFilterValue(spec.filter?.value ?? ''); setFilterValues(spec.filter?.values ?? (spec.filter?.value ? [spec.filter.value] : []));
      return;
    }
    pendingChart.current = chart;
    setSelectedTable(chart.chartSpec.table);
  }

  async function deleteSavedChart(event: ReactMouseEvent, chartId: string) {
    event.stopPropagation();
    const response = await fetch(`/api/dashboards/overview/charts/${chartId}`, { method: 'DELETE' });
    if (response.ok) setSavedCharts((current) => current.filter((chart) => chart.id !== chartId));
  }

  async function duplicateSavedChart(event: ReactMouseEvent, chart: SavedChart) {
    event.stopPropagation();
    if (duplicatingChartId) return;
    setDuplicatingChartId(chart.id);
    setDashboardNotice('');
    const existingTitles = new Set(savedCharts.map((item) => item.title));
    const baseTitle = `${chart.title} copy`.slice(0, 100);
    let title = baseTitle;
    for (let suffix = 2; existingTitles.has(title); suffix += 1) {
      const ending = ` (${suffix})`;
      title = `${baseTitle.slice(0, 100 - ending.length)}${ending}`;
    }
    try {
      const response = await fetch('/api/dashboards/overview/charts', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, chartSpec: chart.chartSpec }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not duplicate this chart.');
      setSavedCharts((current) => [payload as SavedChart, ...current]);
      setDashboardNotice(`Created “${title}”.`);
    } catch (error) {
      setDashboardNotice(error instanceof Error ? error.message : 'Could not duplicate this chart.');
    } finally { setDuplicatingChartId(null); }
  }

  function renderDashboardChart(chart: SavedChart) {
    const spec = normalizeSpec(chart.chartSpec);
    const chartColors = PALETTES[spec.palette ?? 'sage'].colors;
    const grid = spec.showGrid ?? true;
    const format = spec.encodings.y.every((metric) => metric.aggregation === 'count') ? 'number' : spec.valueFormat ?? 'number';
    const currency = spec.currencyCode ?? 'USD';
    const preview = dashboardPreviews[chart.id];
    if (!preview || preview.state === 'loading') return <div className="tile-state"><LoaderCircle size={17} className="spinner" /> Updating preview…</div>;
    if (preview.state === 'error') return <div className="tile-state tile-error">Couldn’t load this chart. Open it to adjust the query.</div>;
    if (!preview.rows.length) return <div className="tile-state">No data for this chart.</div>;
    const savedXFields = spec.encodings.x.fields ?? [spec.encodings.x.field];
    const savedYCategories = spec.encodings.yCategories ?? [];
    const savedDimension = savedXFields[0] ?? savedYCategories[0] ?? '';
    if (spec.chartType === 'table') return <div className="tile-table"><table><thead><tr><th>{fieldLabel(savedDimension)}</th><th>{spec.encodings.y[0]?.aggregation === 'count' ? 'Rows' : fieldLabel(spec.encodings.y[0]?.field ?? '')}</th></tr></thead><tbody>{preview.rows.slice(0, 3).map((row, index) => <tr key={`${row.dimension}-${index}`}><td>{row.dimension}</td><td>{formatValue(row.values[0] ?? 0, spec.encodings.y[0]?.aggregation === 'count' ? 'number' : format, currency)}</td></tr>)}</tbody></table></div>;
    return <div className="tile-chart"><Suspense fallback={<div className="chart-loading" /> }><EChartView rows={preview.rows} chartType={spec.chartType as EChartType} title={chart.title} measures={spec.encodings.y.map((metric) => metric.field)} aggregations={spec.encodings.y.map((metric) => metric.aggregation)} colors={chartColors} showGrid={grid} showLegend={spec.showLegend ?? false} showDataLabels={spec.showDataLabels ?? false} smoothLines={spec.smoothLines ?? true} stackSeries={spec.stackSeries ?? true} xAxisName={fieldLabel(savedXFields[0] ?? savedYCategories[0] ?? '')} yAxisName={spec.encodings.y.length === 1 ? fieldLabel(spec.encodings.y[0]?.field ?? '') : 'Values'} dateDimension={false} valueFormat={format} currencyCode={currency} compact horizontal={spec.chartType === 'bar' && savedXFields.length === 0 && savedYCategories.length > 0} /></Suspense></div>;
  }

  function renderFieldButton(column: Column) {
    return <button key={column.name} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-fieldnote-field', column.name); event.dataTransfer.setData('text/plain', column.name); event.dataTransfer.effectAllowed = 'copy'; setDragField(column.name); setDropError(''); }} onDragEnd={() => { setDragField(''); setDropTarget(''); }} className={`field-row ${dimensionFields.includes(column.name) || yCategories.includes(column.name) || metricFields.includes(column.name) || seriesFields.includes(column.name) || filterField === column.name ? 'selected' : ''}`} onClick={() => { if (!pendingFieldRole) { dropFieldOnChart(column.name); return; } if (pendingFieldRole === 'filter') { if (!filterableColumns.some((item) => item.name === column.name)) { setDropError('Filters currently support text and date fields.'); return; } setFilterField(column.name); setFilterValue(''); setFilterValues([]); setDropError(''); setPendingFieldRole(null); return; } if (assignFieldToRole(column.name, pendingFieldRole)) setPendingFieldRole(null); }} title={`Select ${fieldLabel(column.name)} to add it to the chart`}><span className={`type-badge ${isNumeric(column.type) ? 'numeric' : ''}`}>{isNumeric(column.type) ? '123' : isDate(column.type) ? '◷' : 'Aa'}</span><span className="field-name">{fieldLabel(column.name)}</span><span className="field-type">{column.type}</span></button>;
  }

  function openDataset(table: string) {
    setEditorReturnPage(homePage);
    setActiveChartId(null);
    setSavedBaseline(null);
    setSaveTitle('');
    setPreviewRows([]);
    setColumnState('loading');
    setSelectedTable(table);
  }

  function backToDatasets(destination: HomePage = 'overview') {
    if (!confirmDiscardChanges()) return;
    setActiveChartId(null);
    setSavedBaseline(null);
    setSelectedTable('');
    setColumns([]);
    setPreviewRows([]);
    setPreviewState('idle');
    setIsSaveOpen(false);
    setHomePage(destination);
  }

  return (
    <main className={`app-shell ${selectedTable ? 'editor-shell' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><BarChart3 size={18} /></span><span>fieldnote</span></div>
        <div className="workspace-switch"><span className="workspace-dot" /> My workspace <ChevronDown size={14} /></div>
        <nav className="primary-nav">
          <a title="Overview" aria-label="Overview" className={`nav-item ${!selectedTable && homePage === 'overview' ? 'active' : ''}`} href="#overview" onClick={(event) => { event.preventDefault(); backToDatasets('overview'); }}><Home size={17} /> Overview</a>
          <a title="Dashboards" aria-label="Dashboards" className={`nav-item ${!selectedTable && homePage === 'dashboards' ? 'active' : ''}`} href="#dashboards" onClick={(event) => { event.preventDefault(); backToDatasets('dashboards'); }}><LayoutDashboard size={17} /> Dashboards</a>
          <a title="Browse saved charts and data" aria-label="Browse" className={`nav-item ${!selectedTable && homePage === 'browse' ? 'active' : ''}`} href="#browse" onClick={(event) => { event.preventDefault(); backToDatasets('browse'); }}><BookOpen size={17} /> Browse</a>
          <a title="Data" aria-label="Data" className={`nav-item ${!selectedTable && homePage === 'data' ? 'active' : ''}`} href="#data" onClick={(event) => { event.preventDefault(); backToDatasets('data'); }}><Database size={17} /> Data</a>
        </nav>
        <div className="side-section-heading">YOUR SPACE <button aria-label="Search tables"><Search size={14} /></button></div>
        <button className="side-link" onClick={backToDatasets}>Overview</button>
        <div className="side-footer"><span className={`status-dot ${connectionState}`} />
          {connectionState === 'connected' ? 'ClickHouse connected' : connectionState === 'error' ? 'ClickHouse unavailable' : 'Connecting…'}
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          {selectedTable ? <>
            <div className="editor-topbar-title"><button className="editor-back" onClick={() => backToDatasets(editorReturnPage)}><ChevronLeft size={16} /><span>{editorReturnPage === 'overview' ? 'Overview' : editorReturnPage === 'dashboards' ? 'Dashboards' : editorReturnPage === 'browse' ? 'Browse' : 'Data'}</span></button><span className="editor-title-divider"/><div><small>{selectedTable}</small><input aria-label="Chart title" value={displayTitle} maxLength={100} placeholder={chartTitle} onChange={(event) => setDisplayTitle(event.target.value)} /></div></div>
            <div className="editor-topbar-actions"><button className="topbar-undo" disabled={!layoutUndo} onClick={undoDimensionMove} title="Undo the last dimension move" aria-label="Undo the last dimension move">↶ <span>Undo</span></button><button className="primary-button save-chart-button" disabled={columnState !== 'ready' || previewState !== 'ready'} onClick={() => { setSaveTitle((activeChartId ? savedCharts.find((chart) => chart.id === activeChartId)?.title : null) ?? chartTitle.slice(0, 100)); setSaveError(''); setIsSaveOpen(true); }}>{activeChartId ? 'Save changes' : 'Save chart'}</button></div>
          </> : <button className="avatar">JD</button>}
        </header>

        {!selectedTable ? (
          <div className="page-content">
            <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>{homePage === 'overview' ? 'Overview' : homePage === 'dashboards' ? 'Dashboards' : homePage === 'browse' ? 'Browse content' : 'Data'}</h1><p>{homePage === 'overview' ? 'A clear starting point for your analysis.' : homePage === 'dashboards' ? 'Your saved dashboard charts.' : homePage === 'browse' ? 'Find saved charts and explore available datasets.' : 'Choose a dataset to start a chart.'}</p></div></div>
            {homePage === 'overview' && <div className="welcome-card">
              <div className="welcome-copy"><div className="eyebrow">A CLEARER VIEW</div><h2>Start with a question.</h2><p>Pick a dataset, add a category and a value, and see the answer take shape.</p></div>
              <div className="welcome-art" aria-hidden="true"><div className="art-card"><div className="art-label">Revenue</div><div className="art-value">$24,680</div><div className="art-bars"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="art-line" /></div><div className="art-spark">✳</div></div>
            </div>}
            {homePage === 'overview' && <div className="home-shortcuts"><button onClick={() => setHomePage('dashboards')}><LayoutDashboard size={15}/><span><strong>Dashboards</strong><small>Review saved charts</small></span></button><button onClick={() => setHomePage('browse')}><BookOpen size={15}/><span><strong>Browse</strong><small>Find charts and datasets</small></span></button><button onClick={() => setHomePage('data')}><Database size={15}/><span><strong>Data</strong><small>Start with a dataset</small></span></button></div>}
            {(homePage === 'dashboards' || homePage === 'browse') && <section className="saved-section">
              <div className="saved-heading"><div><h2>{homePage === 'dashboards' ? 'Overview dashboard' : 'Saved charts'}</h2><p>{homePage === 'dashboards' ? 'Saved charts update from their source each time you open this page.' : 'Open a chart to edit it or use it on a dashboard.'}</p>{dashboardNotice && <div className="dashboard-notice" role="status">{dashboardNotice}</div>}</div><div className="saved-heading-actions">{homePage === 'browse' && <label className="chart-search"><Search size={13}/><input aria-label="Search saved charts" placeholder="Search charts" value={chartSearch} onChange={(event) => setChartSearch(event.target.value)} /></label>}<span className="saved-count">{visibleSavedCharts.length} {visibleSavedCharts.length === 1 ? 'chart' : 'charts'}</span></div></div>
              {visibleSavedCharts.length ? <div className="dashboard-grid">{visibleSavedCharts.map((chart) => <article className="dashboard-tile" key={chart.id}>
                <div className="dashboard-tile-header"><button className="dashboard-tile-title" onClick={() => openSavedChart(chart)}><span>{chart.title}</span><small>{chart.chartSpec.table} · {chart.chartSpec.chartType}</small></button><div className="dashboard-tile-actions"><button className="duplicate-chart" aria-label={`Duplicate ${chart.title}`} title="Duplicate report" disabled={Boolean(duplicatingChartId)} onClick={(event) => void duplicateSavedChart(event, chart)}><Copy size={14} /></button><button className="delete-chart" aria-label={`Delete ${chart.title}`} title="Remove chart" onClick={(event) => void deleteSavedChart(event, chart.id)}><Trash2 size={14} /></button></div></div>
                <button className="dashboard-tile-body" onClick={() => openSavedChart(chart)} aria-label={`Open ${chart.title}`}>{renderDashboardChart(chart)}</button>
              </article>)}</div> : <div className="saved-empty">{dashboardLoaded ? homePage === 'browse' && chartSearch ? 'No charts match that search.' : 'No saved charts yet. Build a chart and save it to add it here.' : 'Loading your saved charts…'}</div>}
            </section>}
            {(homePage === 'data' || homePage === 'browse') && <><div className="section-title-row"><div><h2>{homePage === 'browse' ? 'Available datasets' : 'Connected datasets'}</h2><p>Tables ready to explore from your connected source.</p></div><span className="connection-label"><i className={`status-dot ${connectionState}`} /> ClickHouse · analytics</span></div>
            <div className="dataset-toolbar"><label className="search-box"><Search size={16} /><input value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)} placeholder="Search datasets" aria-label="Search datasets" /></label><span>{visibleDatasets.length} {visibleDatasets.length === 1 ? 'dataset' : 'datasets'}</span></div>
            <div className="dataset-list">
              {visibleDatasets.map((dataset) => <button className="dataset-row" key={dataset.name} onClick={() => openDataset(dataset.name)}><span className="dataset-icon"><Database size={17} /></span><span className="dataset-name">{dataset.name}</span><span className="dataset-source">ClickHouse · analytics</span><span className="row-arrow">→</span></button>)}
              {visibleDatasets.length === 0 && <div className="empty-state">{connectionState === 'error' ? 'ClickHouse is unavailable. Start the local data services, then refresh.' : connectionState === 'loading' ? 'Loading available datasets…' : 'No tables match that search.'}</div>}
            </div></>}
            <footer>Make better decisions, one question at a time.</footer>
          </div>
        ) : (
          <div className="builder-page">
            <div className={`builder-layout ${inspectorOpen ? 'inspector-open' : ''}`}>
              <aside className="fields-panel" aria-label="Available fields">
                <div className="fields-panel-heading"><span>DATA</span><span>{columns.length}</span></div>
                <label className="field-search"><Search size={13}/><input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Find a field" aria-label="Find a field" /></label>
                <p className="fields-panel-hint">{pendingFieldRole ? `Choose a field for ${pendingFieldRole === 'x' ? 'Category' : pendingFieldRole === 'y' ? 'Rows' : pendingFieldRole === 'values' ? 'Values' : pendingFieldRole === 'series' ? 'Color' : 'Filters'}.` : 'Select a field to add it to your chart.'}</p>
                <div className="field-list field-drawer-list">
                  {columnState === 'loading' && <div className="field-loading"><LoaderCircle size={15} className="spinner" /> Loading fields…</div>}
                  {columnState === 'error' && <div className="field-loading error-copy">Could not load fields.</div>}
                  <section className="field-group"><div className="field-group-title">DIMENSIONS</div>{columns.filter((column) => !isNumeric(column.type) && fieldLabel(column.name).toLowerCase().includes(fieldSearch.toLowerCase())).map(renderFieldButton)}{columnState === 'ready' && !columns.some((column) => !isNumeric(column.type) && fieldLabel(column.name).toLowerCase().includes(fieldSearch.toLowerCase())) && <div className="field-group-empty">No matching dimensions.</div>}</section>
                  <section className="field-group"><div className="field-group-title">MEASURES</div>{numericColumns.filter((column) => fieldLabel(column.name).toLowerCase().includes(fieldSearch.toLowerCase())).map(renderFieldButton)}{columnState === 'ready' && !numericColumns.some((column) => fieldLabel(column.name).toLowerCase().includes(fieldSearch.toLowerCase())) && <div className="field-group-empty">No matching measures.</div>}</section>
                </div>
              </aside>
              <aside className="builder-panel">
                <div className="editor-panel-tabs" role="tablist" aria-label="Chart options"><button role="tab" aria-selected={editorPanelTab === 'build'} className={editorPanelTab === 'build' ? 'active' : ''} onClick={() => { setEditorPanelTab('build'); setInspectorOpen(true); }}>Build</button><button role="tab" aria-selected={editorPanelTab === 'format'} className={editorPanelTab === 'format' ? 'active' : ''} onClick={() => { setEditorPanelTab('format'); setInspectorOpen(true); }}>Format</button><button className="inspector-close" aria-label="Close chart settings" onClick={() => setInspectorOpen(false)}>×</button></div>
                {editorPanelTab === 'build' && <>
                {renderShelf(chartType === 'table' ? 'COLUMNS' : chartType === 'scatter' ? 'X-AXIS' : 'CATEGORY', 'x', dimensionFields, 'Choose a dimension from Data')}
                {renderShelf(chartType === 'table' ? 'ROWS' : 'ROWS · CATEGORY AXIS', 'y', yCategories, 'Add a row category from Data', chartType === 'table' || chartType === 'heatmap')}
                {layoutNotice && <div className="layout-notice" role="status">{layoutNotice}</div>}
                <div className="shelf-heading"><span>{isCrossTab || chartType === 'heatmap' || chartType === 'table' ? 'VALUES · MEASURES' : isHorizontalBar ? 'X-AXIS · VALUES' : 'Y-AXIS · VALUES'}</span><button onClick={() => setPendingFieldRole('values')}>+ Add</button></div>
                <div role="group" aria-label="Measure values" className={`field-well field-well-multi ${dropTarget === 'values' || pendingFieldRole === 'values' ? 'drop-active' : ''}`} onClick={() => { if (!metricFields.length) setPendingFieldRole('values'); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropTarget('values'); }} onDragLeave={() => setDropTarget('')} onDrop={(event) => { event.preventDefault(); assignFieldToRole(droppedField(event), 'values'); setPendingFieldRole(null); setDragField(''); setDropTarget(''); }}>
                  {!metricFields.length && aggregation === 'count' && <span className="field-pill field-pill-category">Rows <small>COUNT</small></span>}
                  {metricFields.map((field) => <div className="field-pill metric-pill" key={field}><span>{fieldLabel(field)}</span><select aria-label={`Aggregation for ${fieldLabel(field)}`} value={metricAggregation(field)} onChange={(event) => setMetricAggregations((current) => ({ ...current, [field]: event.target.value as Aggregation }))}>{isNumeric(columns.find((column) => column.name === field)?.type ?? '') ? <><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option><option value="count">Count rows</option></> : <option value="count">Count rows</option>}</select><button aria-label={`Remove ${fieldLabel(field)}`} onClick={() => removeMetric(field)}>×</button></div>)}
                  {!metricFields.length && aggregation !== 'count' && <span className="field-well-empty">Add a measure from Data</span>}
                </div>
                <p className="control-hint">Numeric fields default to Sum; text fields count rows. Add more fields to compare. Tables pivot two dimensions into rows and columns.</p>
                <label className="control-label" htmlFor="aggregation-select">DEFAULT SUMMARY</label>
                <select id="aggregation-select" value={aggregation} onChange={(event) => {
                  const next = event.target.value as Aggregation;
                  setAggregation(next);
                  setMetricAggregations(Object.fromEntries(metricFields.map((field) => [field, isNumeric(columns.find((column) => column.name === field)?.type ?? '') ? next : 'count'])));
                }}>
                  <option value="sum" disabled={!numericColumns.length}>Sum · apply to metrics</option><option value="avg" disabled={!numericColumns.length}>Average · apply to metrics</option><option value="min" disabled={!numericColumns.length}>Minimum · apply to metrics</option><option value="max" disabled={!numericColumns.length}>Maximum · apply to metrics</option><option value="count">Count rows · apply to metrics</option>
                </select>
                <p className="control-hint">Numeric fields use this summary; text fields count rows automatically.</p>
                <div className="panel-divider" />
                <div className="marks-card">
                  <div className="shelves-heading">MARKS</div>
                  {renderShelf(chartType === 'heatmap' ? 'COLOR · GROUPING' : 'COLOR', 'series', seriesFields, 'Add a color field from Data')}
                  <label className="mark-toggle"><input type="checkbox" checked={showDataLabels} onChange={(event) => setShowDataLabels(event.target.checked)} /><span><strong>Label</strong><small>Show values on marks</small></span></label>
                </div>
                {renderShelf('FILTERS', 'filter', filterField ? [filterField] : [], 'Add a filter from Data')}
                  {dropError && <div className="drop-feedback" role="alert">{dropError}</div>}
                {!filterField && <div className="filter-shelf-hint">Filter the chart by <button onClick={() => { const first = filterableColumns.find((column) => column.name !== dimension) ?? filterableColumns[0]; if (first) { setFilterField(first.name); setFilterValue(''); setFilterValues([]); } }}>choosing a field</button>.</div>}
                {filterField && <div className="filter-controls"><select aria-label="Filter field" value={filterField} onChange={(event) => { setFilterField(event.target.value); setFilterValue(''); setFilterValues([]); }}>
                  {filterableColumns.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}
                </select><div className="filter-values-heading"><span>{filterValues.length ? `${filterValues.length} selected` : 'All values'}</span><button onClick={() => { setFilterValue(''); setFilterValues(filterValues.length === filterOptions.length ? [] : filterOptions); }}>{filterValues.length === filterOptions.length ? 'Clear' : 'Select all'}</button></div><div className="filter-values-list" role="group" aria-label={`Values for ${fieldLabel(filterField)}`}>{filterOptions.map((value) => <label key={`${value}`}><input type="checkbox" checked={activeFilterValues.includes(value)} onChange={(event) => { setFilterValue(''); setFilterValues((current) => event.target.checked ? [...new Set([...current, value])] : current.filter((item) => item !== value)); }} /><span>{value || '(empty)'}</span></label>)}</div>{filterError && <span className="filter-error">{filterError}</span>}</div>}
                </>}
                {editorPanelTab === 'format' && <>
                <div className="field-list-heading appearance-heading"><span>CHART STYLE</span></div>
                <label className="control-label" htmlFor="palette-select">COLOR THEME</label>
                <select id="palette-select" value={palette} onChange={(event) => setPalette(event.target.value as PaletteName)}>
                  {Object.entries(PALETTES).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
                </select>
                <label className="control-label" htmlFor="sort-select">SORT RESULTS</label>
                <select id="sort-select" value={sortBy === 'dimension' ? 'dimension' : (metricFields.includes(sortField) ? sortField : metricFields[0] ?? 'dimension')} disabled={chartType === 'line' || chartType === 'area'} onChange={(event) => { if (event.target.value === 'dimension') setSortBy('dimension'); else { setSortBy('value'); setSortField(event.target.value); } }}>
                  {chartType === 'line' || chartType === 'area' ? <option value="dimension">Chronological order</option> : <><option value="dimension">Dimension · A to Z</option>{chartMeasures.map((field) => <option key={field} value={field}>{metricAggregation(field)} · {fieldLabel(field)} · largest first</option>)}</>}
                </select>
                {aggregation !== 'count' && <><label className="control-label" htmlFor="value-format-select">NUMBER FORMAT</label>
                <select id="value-format-select" value={valueFormat} onChange={(event) => setValueFormat(event.target.value as ValueFormat)}>
                  <option value="number">Number</option><option value="currency">Currency</option><option value="percent">Percent</option>
                </select>
                {valueFormat === 'currency' && <><label className="control-label" htmlFor="currency-select">CURRENCY</label><select id="currency-select" value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value as typeof currencyCode)}><option value="USD">USD · US Dollar</option><option value="SGD">SGD · Singapore Dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British Pound</option></select></>}
                {valueFormat === 'percent' && <p className="control-hint format-hint">Percent assumes fractional values, for example 0.15 displays as 15%.</p>}</>}
                <div className="appearance-toggles">
                  <label><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /><span>Show grid lines</span></label>
                  <label><input type="checkbox" checked={showLegend} onChange={(event) => setShowLegend(event.target.checked)} /><span>Show legend</span></label>
                  {['line', 'area', 'combo'].includes(chartType) && <label><input type="checkbox" checked={smoothLines} onChange={(event) => setSmoothLines(event.target.checked)} /><span>Smooth lines</span></label>}
                  {seriesFields.length > 0 && (chartType === 'bar' || chartType === 'combo') && <label><input type="checkbox" checked={stackSeries} onChange={(event) => setStackSeries(event.target.checked)} /><span>Stack series</span></label>}
                </div>
                </>}
              </aside>

              <section className={`preview-panel ${dropTarget === 'preview' ? 'preview-drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = dragField ? 'move' : 'copy'; setDropTarget('preview'); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(''); }} onDrop={(event) => { event.preventDefault(); dropFieldOnChart(droppedField(event)); setDragField(''); setDropTarget(''); }}>
                <div className="preview-toolbar"><div><div className="preview-kicker">LIVE PREVIEW</div></div><div className="preview-actions"><div className="chart-type-toolbar" role="group" aria-label="Chart type">
                  <button aria-label="Bar chart" title="Bar chart" aria-pressed={chartType === 'bar'} className={chartType === 'bar' ? 'active' : ''} onClick={() => changeChartType('bar')}><ChartColumn size={16}/></button>
                  <button aria-label="Line chart" title="Line chart" aria-pressed={chartType === 'line'} className={chartType === 'line' ? 'active' : ''} onClick={() => changeChartType('line')}><ChartLine size={16}/></button>
                  <button aria-label="Area chart" title="Area chart" aria-pressed={chartType === 'area'} className={chartType === 'area' ? 'active' : ''} onClick={() => changeChartType('area')}><ChartArea size={16}/></button>
                  <button aria-label="Scatter plot" title="Scatter plot" aria-pressed={chartType === 'scatter'} className={chartType === 'scatter' ? 'active' : ''} onClick={() => changeChartType('scatter')}><ChartScatter size={16}/></button>
                  <button aria-label="Combo chart" title="Combo chart" aria-pressed={chartType === 'combo'} className={chartType === 'combo' ? 'active' : ''} onClick={() => changeChartType('combo')}><ChartNoAxesCombined size={16}/></button>
                  <button aria-label="Pie chart" title="Pie chart" aria-pressed={chartType === 'pie'} className={chartType === 'pie' ? 'active' : ''} onClick={() => changeChartType('pie')}><ChartPie size={16}/></button>
                  <button aria-label="Donut chart" title="Donut chart" aria-pressed={chartType === 'donut'} className={chartType === 'donut' ? 'active' : ''} onClick={() => changeChartType('donut')}><Donut size={16}/></button>
                  <button aria-label="Heatmap" title="Heatmap" aria-pressed={chartType === 'heatmap'} className={chartType === 'heatmap' ? 'active' : ''} onClick={() => changeChartType('heatmap')}><Grid2X2 size={16}/></button>
                  <button aria-label="Table" title="Table" aria-pressed={chartType === 'table'} className={chartType === 'table' ? 'active' : ''} onClick={() => changeChartType('table')}><Table2 size={16}/></button>
                </div><button className={`inspector-toggle ${inspectorOpen && editorPanelTab === 'build' ? 'active' : ''}`} aria-pressed={inspectorOpen && editorPanelTab === 'build'} onClick={() => { if (inspectorOpen && editorPanelTab === 'build') setInspectorOpen(false); else { setEditorPanelTab('build'); setInspectorOpen(true); } }}>Build</button><button className={`inspector-toggle ${inspectorOpen && editorPanelTab === 'format' ? 'active' : ''}`} aria-pressed={inspectorOpen && editorPanelTab === 'format'} onClick={() => { if (inspectorOpen && editorPanelTab === 'format') setInspectorOpen(false); else { setEditorPanelTab('format'); setInspectorOpen(true); } }}>Format</button><button className="export-csv-button" disabled={previewState !== 'ready' || !previewRows.length} onClick={exportPreviewCsv} title={`Download ${previewTruncated ? 'the first 100' : 'all'} aggregated preview rows as CSV`}><Download size={14} /><span>Export CSV</span></button></div></div>
                <div className={`chart-canvas ${chartType === 'table' ? 'table-canvas' : ''}`}>
                  {previewState === 'loading' && <div className="canvas-message"><LoaderCircle size={21} className="spinner" /><span>Running your preview…</span></div>}
                  {previewState === 'error' && <div className="canvas-message error-copy"><strong>We couldn’t build this preview.</strong><span>{previewError}</span></div>}
                  {previewState === 'ready' && previewRows.length === 0 && <div className="canvas-message"><span>No rows matched this chart.</span></div>}
                  {previewState === 'ready' && previewRows.length > 0 && chartType !== 'table' && <div className="chart-frame"><Suspense fallback={<div className="canvas-message">Loading chart…</div>}><EChartView rows={previewRows} chartType={chartType} title={chartTitle} measures={chartMeasures} aggregations={chartMeasures.map(metricAggregation)} colors={selectedPalette.colors} showGrid={showGrid} showLegend={showLegend} showDataLabels={showDataLabels} smoothLines={smoothLines} stackSeries={stackSeries} xAxisName={fieldLabel(dimensionFields[0] ?? '')} yAxisName={chartMeasures.length === 1 ? fieldLabel(chartMeasures[0]) : 'Values'} dateDimension={isDateDimension} valueFormat={chartValueFormat} currencyCode={currencyCode} horizontal={isHorizontalBar} /></Suspense></div>}
                  {previewState === 'ready' && previewRows.length > 0 && chartType === 'table' && <ReportDataTable rows={previewRows} xFields={dimensionFields} yFields={yCategories} seriesFields={seriesFields} measures={chartMeasures.map((field) => ({ field, aggregation: metricAggregation(field) }))} colors={selectedPalette.colors} valueFormat={valueFormat} currencyCode={currencyCode} onDimensionDragStart={(field) => { setDragField(field); setDropError(''); }} onDimensionDragEnd={() => { setDragField(''); setDropTarget(''); }} onDimensionDrop={positionDimension} />}
                  {previewState === 'idle' && <div className="canvas-message">Choose fields to see your chart.</div>}
                </div>
    <div className="preview-footer"><span><i className="source-dot" /> Live query · ClickHouse</span><span>{previewState === 'ready' ? `${previewRows.length} ${previewRows.length === 1 ? 'group' : 'groups'}${previewTruncated ? ' · showing first 100' : ''}` : 'Up to 100 groups'}</span></div>
              </section>
            </div>
            <div className="builder-tip"><WandSparkles size={15} /><span>Tip</span> Drag dimensions between Rows and Columns—or drag a table header into the opposite well—to reshape the cross-tab.</div>
          </div>
        )}
      </section>
      {isSaveOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsSaveOpen(false); }}>
        <form className="save-modal" role="dialog" aria-modal="true" aria-labelledby="save-title" onSubmit={(event) => { event.preventDefault(); void saveChart(); }}>
          <div className="modal-icon"><BarChart3 size={18} /></div><h2 id="save-title">{activeChartId ? 'Update saved chart' : 'Save to Overview'}</h2><p>{activeChartId ? 'Save your latest chart settings to this report.' : 'Your chart definition will be saved with this dashboard.'}</p>
          <label className="control-label" htmlFor="saved-chart-title">CHART NAME</label><input id="saved-chart-title" value={saveTitle} maxLength={100} autoFocus onChange={(event) => setSaveTitle(event.target.value)} />
          {saveError && <div className="save-error">{saveError}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsSaveOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={isSaving}>{isSaving ? 'Saving…' : activeChartId ? 'Save changes' : 'Save chart'}</button></div>
        </form>
      </div>}
    </main>
  );
}
