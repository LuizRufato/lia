export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let value = partsFormatterCache.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatterCache.set(timezone, value);
  }
  return value;
}

export function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const values = Object.fromEntries(
    formatter(timezone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

export function getMinutesSinceMidnight(date: Date, timezone: string): number {
  const parts = getZonedDateParts(date, timezone);
  return parts.hour * 60 + parts.minute;
}

function timezoneOffsetMs(utcCandidate: Date, timezone: string): number {
  const parts = getZonedDateParts(utcCandidate, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  return asUtc - utcCandidate.getTime();
}

/** Converts a wall-clock time in an IANA zone to an instant. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 3; i += 1) {
    candidate = new Date(
      Date.UTC(year, month - 1, day, hour, minute) -
        timezoneOffsetMs(candidate, timezone),
    );
  }
  return candidate;
}

export function startOfLocalDay(date: Date, timezone: string): Date {
  const parts = getZonedDateParts(date, timezone);
  return zonedTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timezone);
}

export function nextScheduleStart(
  date: Date,
  timezone: string,
  startMinute: number,
  endMinute: number,
): Date {
  const parts = getZonedDateParts(date, timezone);
  const currentMinute = parts.hour * 60 + parts.minute;
  const inside = startMinute <= endMinute
    ? currentMinute >= startMinute && currentMinute <= endMinute
    : currentMinute >= startMinute || currentMinute <= endMinute;
  if (inside) return date;

  const dayOffset = startMinute <= endMinute || currentMinute < startMinute ? 0 : 1;
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  return zonedTimeToUtc(
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    Math.floor(startMinute / 60),
    startMinute % 60,
    timezone,
  );
}

export function nextLocalDay(date: Date, timezone: string): Date {
  const parts = getZonedDateParts(date, timezone);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return zonedTimeToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    timezone,
  );
}
