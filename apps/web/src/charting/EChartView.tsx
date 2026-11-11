import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { UniversalTransition } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import type { ValueFormat } from './format';
import { fieldLabel, formatAxisLabel, formatCompactValue, formatValue } from './format';

echarts.use([BarChart, HeatmapChart, LineChart, PieChart, ScatterChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, UniversalTransition, CanvasRenderer]);

export type EChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'combo' | 'heatmap';
export type EChartRow = { dimension: string; xDimension?: string; yDimension?: string; series?: string; values: number[] };

type EChartViewProps = {
  rows: EChartRow[]; chartType: EChartType; title: string; measures: string[]; aggregations: string[];
  colors: string[]; showGrid: boolean; showLegend: boolean; showDataLabels: boolean; dateDimension: boolean;
  valueFormat: ValueFormat; currencyCode: string; compact?: boolean; horizontal?: boolean; smoothLines: boolean; stackSeries: boolean; xAxisName?: string; yAxisName?: string;
};

export function EChartView({ rows, chartType, title, measures, aggregations, colors, showGrid, showLegend, showDataLabels, dateDimension, valueFormat, currencyCode, compact = false, horizontal = false, smoothLines, stackSeries, xAxisName = '', yAxisName = '' }: EChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const metricNames = measures.map((measure) => fieldLabel(measure));
  const formattedType: ValueFormat = aggregations.some((aggregation) => aggregation === 'count') ? 'number' : valueFormat;
  const option = useMemo<EChartsOption>(() => {
    const legend = { show: showLegend || Boolean(rows.some((row) => row.series) || measures.length > 1), bottom: 0 };
    const tooltip = {
      trigger: chartType === 'pie' || chartType === 'donut' ? 'item' as const : 'axis' as const,
      axisPointer: { type: chartType === 'bar' ? 'shadow' as const : 'line' as const },
      valueFormatter: (value: unknown) => formatValue(String(value ?? 0), formattedType, currencyCode),
    };
    const common = { aria: { enabled: true, decal: { show: false } }, tooltip, legend };
    const axisLabel = { fontSize: compact ? 9 : 11 };
    if (chartType === 'heatmap') {
      const xCategories = [...new Set(rows.map((row) => row.xDimension || row.dimension || 'All'))];
      const yLabels = measures.flatMap((_, metricIndex) => rows.map((row) => `${row.yDimension || 'All'}${row.series ? ` · ${row.series}` : ''}${measures.length > 1 ? ` · ${metricNames[metricIndex]}` : ''}`));
      const yCategories = [...new Set(yLabels)];
      const data = measures.flatMap((_, metricIndex) => rows.map((row, rowIndex) => {
        const xIndex = xCategories.indexOf(row.xDimension || row.dimension || 'All');
        const yLabel = `${row.yDimension || 'All'}${row.series ? ` · ${row.series}` : ''}${measures.length > 1 ? ` · ${metricNames[metricIndex]}` : ''}`;
        const yIndex = yCategories.indexOf(yLabel);
        return [xIndex, yIndex, row.values[metricIndex] ?? 0];
      }));
      const heatValues = data.map((point) => Number(point[2]));
      return { ...common, legend: { show: false }, grid: { left: compact ? 6 : 110, right: compact ? 6 : 28, top: 20, bottom: compact ? 6 : 78, containLabel: !compact },
        tooltip: { ...tooltip, trigger: 'item' as const },
        visualMap: { min: Math.min(0, ...heatValues), max: Math.max(1, ...heatValues), calculable: true, orient: 'horizontal', left: 'center', bottom: compact ? -8 : 8 },
        xAxis: { type: 'category', data: xCategories, axisLabel: compact ? { show: false } : axisLabel, splitArea: { show: true } },
        yAxis: { type: 'category', data: yCategories, axisLabel: compact ? { show: false } : axisLabel, splitArea: { show: true } },
        series: [{ id: 'metric-0', type: 'heatmap', name: metricNames[0] ?? 'Value', universalTransition: true, data, label: { show: showDataLabels && data.length <= 64 }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.2)' } } }] };
    }
    if (chartType === 'pie' || chartType === 'donut') return {
      ...common, series: [{ id: 'metric-0', type: 'pie', name: metricNames[0], universalTransition: true, radius: chartType === 'donut' ? ['48%', '76%'] : '76%', center: ['50%', showLegend ? '43%' : '50%'],
        data: rows.map((row, index) => ({ name: row.dimension, value: row.values[0] ?? 0, itemStyle: { color: colors[index % colors.length] } })),
        itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: showDataLabels, formatter: (params: { name?: string; value?: unknown }) => `${params.name ?? ''}: ${formatValue(Number(params.value ?? 0), formattedType, currencyCode)}` }, emphasis: { scale: true, scaleSize: 6, label: { show: true, fontWeight: 600 } }, minShowLabelAngle: 5 }],
    };
    const categories = [...new Set(rows.map((row) => row.dimension))];
    const breakdowns = [...new Set(rows.map((row) => row.series ?? ''))].sort((left, right) => left.localeCompare(right));
    const hasBreakdown = breakdowns.some(Boolean);
    const breakdownValues = breakdowns.filter(Boolean);
    const breakdownColor = (value: string, metricIndex: number) => hasBreakdown
      ? value ? colors[Math.max(0, breakdownValues.indexOf(value)) % colors.length] : colors[breakdownValues.length % colors.length]
      : colors[metricIndex % colors.length];
    const series: NonNullable<EChartsOption['series']> = [];
    if (chartType === 'scatter') {
      measures.forEach((measure, metricIndex) => (hasBreakdown ? breakdowns : ['']).forEach((breakdown) => {
        const points = rows.filter((row) => (row.series ?? '') === breakdown).map((row) => ({ name: row.dimension, value: [Number(row.dimension), row.values[metricIndex] ?? 0] }));
        series.push({ id: `metric-${metricIndex}${hasBreakdown ? `-${breakdown}` : ''}`, type: 'scatter', name: hasBreakdown ? `${metricNames[metricIndex]} · ${fieldLabel(breakdown)}` : metricNames[metricIndex], universalTransition: true, data: points, label: { show: showDataLabels, position: 'top', formatter: (params: { name?: string }) => params.name ?? '' }, itemStyle: { color: breakdownColor(breakdown, metricIndex) } });
      }));
    } else {
      measures.forEach((measure, metricIndex) => (hasBreakdown ? breakdowns : ['']).forEach((breakdown) => {
        const name = hasBreakdown ? `${metricNames[metricIndex]} · ${fieldLabel(breakdown)}` : metricNames[metricIndex];
        const metricType = chartType === 'combo' && metricIndex > 0 ? 'line' : chartType === 'bar' || chartType === 'combo' ? 'bar' : 'line';
        const color = breakdownColor(breakdown, metricIndex);
        const data = categories.map((category) => ({ name: category, value: rows.find((row) => row.dimension === category && (row.series ?? '') === breakdown)?.values[metricIndex] ?? null }));
        series.push({ id: `metric-${metricIndex}${hasBreakdown ? `-${breakdown}` : ''}`, type: metricType, name, universalTransition: true, data, label: { show: showDataLabels, position: horizontal ? 'right' : 'top', formatter: (params: { value?: unknown }) => formatValue(Number(params.value ?? 0), formattedType, currencyCode) }, stack: hasBreakdown && stackSeries && metricType === 'bar' ? `stack-${metricIndex}` : undefined, smooth: metricType === 'line' && smoothLines, showSymbol: metricType === 'line' && !compact, itemStyle: { color }, areaStyle: chartType === 'area' ? {} : undefined, barMaxWidth: compact ? 24 : 54 });
      }));
    }
    const axisInterval = categories.length > 16 ? Math.ceil(categories.length / 12) - 1 : 0;
    const valueAxis = { type: 'value' as const, axisLabel: compact ? { show: false } : { ...axisLabel, formatter: (value: number) => formatCompactValue(value, formattedType, currencyCode) }, splitLine: { show: showGrid && !compact } };
    const categoryAxis = { type: 'category' as const, data: categories, inverse: horizontal, axisLabel: compact ? { show: false } : { ...axisLabel, interval: horizontal ? 0 : axisInterval, rotate: horizontal ? 0 : categories.length > 8 ? 24 : 0, formatter: (value: string) => formatAxisLabel(value, dateDimension) } };
    return { ...common, grid: { left: compact ? 6 : chartType === 'scatter' ? 84 : horizontal ? 118 : 62, right: compact ? 6 : 20, top: compact ? 12 : 20, bottom: compact ? 6 : chartType === 'scatter' ? 78 : horizontal ? 44 : 62, containLabel: !compact },
      xAxis: chartType === 'scatter' ? { ...valueAxis, name: compact ? '' : xAxisName, nameLocation: 'middle', nameGap: 32 } : horizontal ? valueAxis : categoryAxis,
      yAxis: chartType === 'scatter' ? { ...valueAxis, name: compact ? '' : yAxisName, nameLocation: 'middle', nameGap: 54 } : horizontal ? categoryAxis : valueAxis, series };
  }, [chartType, colors, compact, currencyCode, dateDimension, formattedType, horizontal, metricNames, measures, rows, showDataLabels, showGrid, showLegend, smoothLines, stackSeries, xAxisName, yAxisName]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => { observer.disconnect(); chart.dispose(); chartRef.current = null; };
  }, []);
  useEffect(() => { chartRef.current?.setOption(option, { notMerge: true }); }, [option]);
  return <div ref={containerRef} className="echart-canvas" role="img" aria-label={title} />;
}
