export type ValueFormat = 'number' | 'currency' | 'percent';

export function fieldLabel(name: string) {
  return name.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatValue(value: string | number, format: ValueFormat = 'number', currencyCode: string = 'USD') {
  const options: Intl.NumberFormatOptions = format === 'currency'
    ? { style: 'currency', currency: currencyCode, maximumFractionDigits: 2 }
    : format === 'percent'
      ? { style: 'percent', maximumFractionDigits: 2 }
      : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat(undefined, options).format(Number(value));
}

export function formatCompactValue(value: number, format: ValueFormat = 'number', currencyCode: string = 'USD') {
  const options: Intl.NumberFormatOptions = format === 'currency'
    ? { style: 'currency', currency: currencyCode, notation: 'compact', maximumFractionDigits: 1 }
    : format === 'percent'
      ? { style: 'percent', notation: 'compact', maximumFractionDigits: 1 }
      : { notation: 'compact', maximumFractionDigits: 1 };
  return new Intl.NumberFormat(undefined, options).format(value);
}

export function formatAxisLabel(value: string, dateValue: boolean) {
  if (dateValue && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(`${value.slice(0, 10)}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: '2-digit' }).format(date);
  }
  return value.length > 20 ? `${value.slice(0, 18)}…` : value;
}
