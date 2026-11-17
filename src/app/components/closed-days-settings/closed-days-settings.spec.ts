import { describe, expect, it } from 'vitest';
import { datesBetween, groupIntoRanges } from './closed-days-settings';

describe('closed days helpers', () => {
  it('expands a range across a month end', () => {
    expect(datesBetween('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('groups consecutive days and keeps single days apart', () => {
    const ranges = groupIntoRanges(['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31']);
    expect(ranges.map(r => [r.start, r.end])).toEqual([['2026-12-24', '2026-12-26'], ['2026-12-31', '2026-12-31']]);
  });
});
