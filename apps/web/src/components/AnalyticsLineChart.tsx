"use client";

export type AnalyticsMetric =
  "clicks" | "sales" | "grossSalesCents" | "expectedCommissionCents";

export type AnalyticsHistoryPoint = {
  at: string;
  clicks: number;
  sales: number;
  grossSalesCents: number;
  expectedCommissionCents: number;
};

type AnalyticsLineChartProps = {
  data: AnalyticsHistoryPoint[];
  metric: AnalyticsMetric;
  hourly: boolean;
  timezone: string;
  onPointFocus?: (index: number | null) => void;
  focusedIndex?: number | null;
};

const metricLabels: Record<AnalyticsMetric, string> = {
  clicks: "Cliques",
  sales: "Vendas",
  grossSalesCents: "Valor vendido",
  expectedCommissionCents: "Comissão prevista",
};

const currency = (cents: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);

const valueFor = (point: AnalyticsHistoryPoint, metric: AnalyticsMetric) =>
  point[metric];

const formatValue = (value: number, metric: AnalyticsMetric) =>
  metric === "grossSalesCents" || metric === "expectedCommissionCents"
    ? currency(value)
    : new Intl.NumberFormat("pt-BR").format(value);

const formatBucket = (at: string, hourly: boolean, timezone: string) => {
  const date = new Date(at);
  if (hourly) {
    const hour = new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date);
    return `${hour}h`;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
};

const formatTooltipTime = (at: string, hourly: boolean, timezone: string) => {
  const date = new Date(at);
  if (!hourly) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      dateStyle: "short",
    }).format(date);
  }
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const start = formatter.format(date);
  const hour = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${start} – ${hour}:59`;
};

const smoothPath = (points: Array<{ x: number; y: number }>) => {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midpointX = (previous.x + point.x) / 2;
    return `${path} C ${midpointX} ${previous.y}, ${midpointX} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
};

export function AnalyticsLineChart({
  data,
  metric,
  hourly,
  timezone,
  onPointFocus,
  focusedIndex = null,
}: AnalyticsLineChartProps) {
  const width = 720;
  const height = 280;
  const left = 46;
  const right = 18;
  const top = 18;
  const bottom = 44;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const values = data.map((point) => valueFor(point, metric));
  const max = Math.max(1, ...values);
  const points = data.map((point, index) => ({
    x:
      left +
      (data.length === 1
        ? chartWidth / 2
        : (index / (data.length - 1)) * chartWidth),
    y: top + chartHeight - (valueFor(point, metric) / max) * chartHeight,
  }));
  const line = smoothPath(points);
  const area = points.length
    ? `${points[0].x},${top + chartHeight} ${points.map((point) => `${point.x},${point.y}`).join(" ")} ${points[points.length - 1].x},${top + chartHeight}`
    : "";
  const labelStep = Math.max(1, Math.ceil(data.length / (hourly ? 8 : 7)));

  return (
    <div className="relative w-full min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto min-h-[240px] w-full overflow-visible"
        role="img"
        aria-label={`Gráfico de linha de ${metricLabels[metric]}`}
      >
        <title>{`Histórico de ${metricLabels[metric]}`}</title>
        {[0, 1, 2, 3, 4].map((step) => {
          const y = top + (chartHeight / 4) * step;
          const value = Math.round(max - (max / 4) * step);
          return (
            <g key={step}>
              <line
                x1={left}
                x2={width - right}
                y1={y}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth="1"
              />
              <text
                x={left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-gray-400 text-[11px]"
              >
                {formatValue(value, metric)}
              </text>
            </g>
          );
        })}
        {area && <polygon points={area} fill="#2563eb" fillOpacity="0.08" />}
        <path
          d={line}
          fill="none"
          stroke="#2563eb"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        {data.map((point, index) => {
          const coordinate = points[index];
          const active = focusedIndex === index;
          return (
            <g key={point.at}>
              <circle
                cx={coordinate.x}
                cy={coordinate.y}
                r={active ? 6 : 4}
                fill="white"
                stroke="#2563eb"
                strokeWidth="3"
                tabIndex={0}
                aria-label={`${formatTooltipTime(point.at, hourly, timezone)}. Cliques: ${point.clicks}. Vendas: ${point.sales}. Valor vendido: ${currency(point.grossSalesCents)}. Comissão prevista: ${currency(point.expectedCommissionCents)}.`}
                onMouseEnter={() => onPointFocus?.(index)}
                onMouseLeave={() => onPointFocus?.(null)}
                onFocus={() => onPointFocus?.(index)}
                onBlur={() => onPointFocus?.(null)}
                onTouchStart={() => onPointFocus?.(index)}
              />
              {index % labelStep === 0 && (
                <text
                  x={coordinate.x}
                  y={height - 15}
                  textAnchor="middle"
                  className="fill-gray-400 text-[11px]"
                >
                  {formatBucket(point.at, hourly, timezone)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {focusedIndex != null && data[focusedIndex] && (
        <div className="pointer-events-none absolute left-1/2 top-2 z-10 w-56 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg sm:left-auto sm:right-2 sm:translate-x-0">
          <p className="mb-2 font-semibold text-gray-900">
            {formatTooltipTime(data[focusedIndex].at, hourly, timezone)}
          </p>
          <div className="space-y-1">
            <p>
              Cliques:{" "}
              {new Intl.NumberFormat("pt-BR").format(data[focusedIndex].clicks)}
            </p>
            <p>
              Vendas:{" "}
              {new Intl.NumberFormat("pt-BR").format(data[focusedIndex].sales)}
            </p>
            <p>Valor vendido: {currency(data[focusedIndex].grossSalesCents)}</p>
            <p>
              Comissão prevista:{" "}
              {currency(data[focusedIndex].expectedCommissionCents)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
