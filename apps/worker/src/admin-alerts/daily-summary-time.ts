export const DAILY_SUMMARY_HOUR = 22;
export const DAILY_SUMMARY_MINUTE = 10;
export const DAILY_SUMMARY_TIMEZONE = 'America/Campo_Grande';

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DAILY_SUMMARY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DAILY_SUMMARY_TIMEZONE,
  timeZoneName: 'shortOffset',
});

export function getZonedParts(date: Date): ZonedParts {
  const values = Object.fromEntries(
    partsFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<string, number>;
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function getOffsetMinutes(date: Date): number {
  const value = offsetFormatter
    .formatToParts(date)
    .find(({ type }) => type === 'timeZoneName')?.value;
  const match =
    /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/.exec(
      value || 'GMT',
    );
  if (!match?.groups?.sign) return 0;
  const minutes =
    Number(match.groups.hours) * 60 + Number(match.groups.minutes || 0);
  return match.groups.sign === '-' ? -minutes : minutes;
}

function getLocalDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const firstPass = new Date(
    naiveUtc - getOffsetMinutes(new Date(naiveUtc)) * 60_000,
  );
  return new Date(naiveUtc - getOffsetMinutes(firstPass) * 60_000);
}

export function getLocalDayWindow(now: Date) {
  const parts = getZonedParts(now);
  const localDate = [parts.year, parts.month, parts.day]
    .map((value, index) =>
      index === 0 ? String(value) : String(value).padStart(2, '0'),
    )
    .join('-');
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const firstPass = new Date(
    naiveUtc - getOffsetMinutes(new Date(naiveUtc)) * 60_000,
  );
  const start = new Date(naiveUtc - getOffsetMinutes(firstPass) * 60_000);
  return { localDate, start, end: now };
}

export function getDailySummaryConversionWindow(now: Date) {
  const parts = getZonedParts(now);
  const previousDay = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - 1),
  );
  const currentCutoff = getLocalDateTime(
    parts.year,
    parts.month,
    parts.day,
    DAILY_SUMMARY_HOUR,
    DAILY_SUMMARY_MINUTE,
  );
  const previousCutoff = getLocalDateTime(
    previousDay.getUTCFullYear(),
    previousDay.getUTCMonth() + 1,
    previousDay.getUTCDate(),
    DAILY_SUMMARY_HOUR,
    DAILY_SUMMARY_MINUTE,
  );
  return { start: previousCutoff, end: currentCutoff };
}

export function isDailySummaryTime(now: Date): boolean {
  const parts = getZonedParts(now);
  return (
    parts.hour === DAILY_SUMMARY_HOUR && parts.minute === DAILY_SUMMARY_MINUTE
  );
}
