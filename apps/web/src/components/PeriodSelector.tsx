"use client";

export type PeriodKey =
  "today" | "yesterday" | "7d" | "30d" | "this_month" | "last_month" | "custom";

const OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
  { value: "custom", label: "Personalizado" },
];

type PeriodSelectorProps = {
  value: PeriodKey;
  dateFrom: string;
  dateTo: string;
  onChange: (value: PeriodKey) => void;
  onDateChange: (name: "dateFrom" | "dateTo", value: string) => void;
};

export function PeriodSelector({
  value,
  dateFrom,
  dateTo,
  onChange,
  onDateChange,
}: PeriodSelectorProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
        Período
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as PeriodKey)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {value === "custom" && (
        <>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
            De
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => onDateChange("dateFrom", event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
            Até
            <input
              type="date"
              value={dateTo}
              onChange={(event) => onDateChange("dateTo", event.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-400"
            />
          </label>
        </>
      )}
    </div>
  );
}
