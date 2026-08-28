import {
  getLocalDayWindow,
  getZonedParts,
  isDailySummaryTime,
} from './daily-summary-time';

describe('daily summary schedule', () => {
  it('recognizes exactly 22:10 in Campo Grande', () => {
    const summaryTime = new Date('2026-08-29T02:10:00.000Z');
    const adjacentMinute = new Date('2026-08-29T02:11:00.000Z');

    expect(getZonedParts(summaryTime)).toMatchObject({
      year: 2026,
      month: 8,
      day: 28,
      hour: 22,
      minute: 10,
    });
    expect(isDailySummaryTime(summaryTime)).toBe(true);
    expect(isDailySummaryTime(adjacentMinute)).toBe(false);
  });

  it('uses the local day across the UTC date boundary', () => {
    const now = new Date('2026-08-29T02:10:00.000Z');
    const window = getLocalDayWindow(now);

    expect(window.localDate).toBe('2026-08-28');
    expect(window.start.toISOString()).toBe('2026-08-28T04:00:00.000Z');
    expect(window.end).toBe(now);
  });
});
