import { AdminAlertsScheduler } from './admin-alerts.scheduler';

describe('AdminAlertsScheduler', () => {
  afterEach(() => jest.useRealTimers());

  it('generates summaries only at 22:10 Campo Grande time', async () => {
    const events = {
      scheduleDailySummaries: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new AdminAlertsScheduler(events as any);

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-29T02:10:00.000Z'));
    await scheduler.scheduleDailySummary();
    expect(events.scheduleDailySummaries).toHaveBeenCalledTimes(1);

    events.scheduleDailySummaries.mockClear();
    jest.setSystemTime(new Date('2026-08-29T02:11:00.000Z'));
    await scheduler.scheduleDailySummary();
    expect(events.scheduleDailySummaries).not.toHaveBeenCalled();
  });
});
