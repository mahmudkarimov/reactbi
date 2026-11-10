import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import type { ValueFormat } from './format';
import { fieldLabel, formatAxisLabel, formatCompactValue, formatValue } from './format';

echarts.use([BarChart, HeatmapChart, LineChart, PieChart, ScatterChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export type EChartType = 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'scatter' | 'combo' | 'heatmap';
export type EChartRow = { dimension: string; xDimension?: string; yDimension?: string; series?: string; values: number[] };

type EChartViewProps = {
  rows: EChartRow[]; chartType: EChartType; title: string; measures: string[]; aggregations: string[];
  colors: string[]; showGrid: boolean; showLegend: boolean; dateDimension: boolean;
  valueFormat: ValueFormat; currencyCode: string; compact?: boolean; horizontal?: boolean;
};

export function EChartView({ rows, chartType, title, measures, aggregations, colors, showGrid, showLegend, dateDimension, valueFormat, currencyCode, compact = false, horizontal = false }: EChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const metricNames = measures.map((measure, index) => aggregations[index] === 'count' ? 'Rows' : `${fieldLabel(aggregations[index] ?? 'sum')} · ${fieldLabel(measure)}`);
  const formattedType: ValueFormat = aggregations.some((aggregation) => aggregation === 'count') ? 'number' : valueFormat;
  const option = useMemo<EChartsOption>(() => {
    const legend = { show: showLegend || Boolean(rows.some((row) => row.series) || measures.length > 1), bottom: 0, textStyle: { color: '#778379', fontSize: compact ? 9 : 11 } };
    const tooltip = {
      trigger: chartType === 'pie' || chartType === 'donut' ? 'item' as const : 'axis' as const,
      axisPointer: { type: chartType === 'bar' ? 'shadow' as const : 'line' as const },
      valueFormatter: (value: unknown) => formatValue(String(value ?? 0), formattedType, currencyCode),
      backgroundColor: '#ffffff', borderColor: '#e5ebe3', borderWidth: 1,
      textStyle: { color: '#35453a', fontFamily: 'DM Sans, sans-serif', fontSize: compact ? 10 : 12 },
      extraCssText: 'box-shadow: 0 8px 24px rgba(35,55,40,.10); border-radius: 9px;',
    };
    const common = { animationDuration: 350, aria: { enabled: true, decal: { show: false } }, tooltip, legend };
    const axisLabel = { color: '#879289', fontFamily: 'DM Sans, sans-serif', fontSize: compact ? 9 : 10 };
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
        visualMap: { min: Math.min(0, ...heatValues), max: Math.max(1, ...heatValues), calculable: true, orient: 'horizontal', left: 'center', bottom: compact ? -8 : 8, textStyle: { color: '#778379', fontSize: compact ? 8 : 10 } },
        xAxis: { type: 'category', data: xCategories, axisLabel: compact ? { show: false } : axisLabel, splitArea: { show: true }, axisLine: { lineStyle: { color: '#e7ece6' } }, axisTick: { show: false } },
        yAxis: { type: 'category', data: yCategories, axisLabel: compact ? { show: false } : axisLabel, splitArea: { show: true }, axisLine: { lineStyle: { color: '#e7ece6' } }, axisTick: { show: false } },
        series: [{ type: 'heatmap', name: metricNames[0] ?? 'Value', data, label: { show: data.length <= 64, color: '#35453a', fontSize: compact ? 8 : 10 }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(35,55,40,.22)' } } }] };
    }
    if (chartType === 'pie' || chartType === 'donut') return {
      ...common, series: [{ type: 'pie', name: metricNames[0], radius: chartType === 'donut' ? ['48%', '76%'] : '76%', center: ['50%', showLegend ? '43%' : '50%'],
        data: rows.map((row, index) => ({ name: row.dimension, value: row.values[0] ?? 0, itemStyle: { color: colors[index % colors.length] } })),
        itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 }, label: { show: false }, emphasis: { scale: true, scaleSize: 6, label: { show: true, fontWeight: 600, color: '#35453a' } }, minShowLabelAngle: 5 }],
    };
    const categories = [...new Set(rows.map((row) => row.dimension))];
    const breakdowns = [...new Set(rows.map((row) => row.series ?? ''))].sort((left, right) => left.localeCompare(right));
    const hasBreakdown = breakdowns.some(Boolean);
    const breakdownValues = breakdowns.filter(Boolean);
    const breakdownColor = (value: string, metricIndex: number) => hasBreakdown
      ? value ? colors[Math.max(0, breakdownValues.indexOf(value)) % colors.length] : '#aeb9af'
      : colors[metricIndex % colors.length];
    const series: NonNullable<EChartsOption['series']> = [];
    if (chartType === 'scatter') {
      measures.forEach((measure, metricIndex) => (hasBreakdown ? breakdowns : ['']).forEach((breakdown) => {
        const points = rows.filter((row) => (row.series ?? '') === breakdown).map((row) => [Number(row.dimension), row.values[metricIndex] ?? 0]);
        series.push({ type: 'scatter', name: hasBreakdown ? `${metricNames[metricIndex]} · ${fieldLabel(breakdown)}` : metricNames[metricIndex], data: points, itemStyle: { color: breakdownColor(breakdown, metricIndex) }, symbolSize: 9 });
      }));
    } else {
      measures.forEach((measure, metricIndex) => (hasBreakdown ? breakdowns : ['']).forEach((breakdown) => {
        const name = hasBreakdown ? `${metricNames[metricIndex]} · ${fieldLabel(breakdown)}` : metricNames[metricIndex];
        const metricType = chartType === 'combo' && metricIndex > 0 ? 'line' : chartType === 'bar' || chartType === 'combo' ? 'bar' : 'line';
        const color = breakdownColor(breakdown, metricIndex);
        const data = categories.map((category) => rows.find((row) => row.dimension === category && (row.series ?? '') === breakdown)?.values[metricIndex] ?? null);
        series.push({ type: metricType, name, data, stack: hasBreakdown && metricType === 'bar' ? `stack-${metricIndex}` : undefined, smooth: metricType === 'line', showSymbol: metricType === 'line' && !compact, symbolSize: 7, lineStyle: { color, width: 2.5 }, itemStyle: metricType === 'bar' ? { color, borderRadius: horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0] } : { color }, areaStyle: chartType === 'area' ? { color, opacity: 0.12 } : undefined, barMaxWidth: compact ? 24 : 54 });
      }));
    }
    const axisInterval = categories.length > 16 ? Math.ceil(categories.length / 12) - 1 : 0;
    const valueAxis = { type: 'value' as const, axisLabel: compact ? { show: false } : { ...axisLabel, formatter: (value: number) => formatCompactValue(value, formattedType, currencyCode) }, splitLine: { show: showGrid && !compact, lineStyle: { color: '#edf0eb', type: 'dashed' as const } }, axisLine: { show: false }, axisTick: { show: false } };
    const categoryAxis = { type: 'category' as const, data: categories, inverse: horizontal, axisLabel: compact ? { show: false } : { ...axisLabel, interval: horizontal ? 0 : axisInterval, rotate: horizontal ? 0 : categories.length > 8 ? 24 : 0, formatter: (value: string) => formatAxisLabel(value, dateDimension) }, axisLine: { lineStyle: { color: '#e7ece6' } }, axisTick: { show: false } };
    return { ...common, grid: { left: compact ? 6 : horizontal ? 118 : 62, right: compact ? 6 : 20, top: compact ? 12 : 20, bottom: compact ? 6 : horizontal ? 44 : 62, containLabel: !compact },
      xAxis: chartType === 'scatter' ? valueAxis : horizontal ? valueAxis : categoryAxis,
      yAxis: horizontal && chartType !== 'scatter' ? categoryAxis : valueAxis, series };
  }, [chartType, colors, compact, currencyCode, dateDimension, formattedType, horizontal, metricNames, measures, rows, showGrid, showLegend]);

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
