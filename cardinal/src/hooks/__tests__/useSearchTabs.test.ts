import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSearchTabs } from '../useSearchTabs';

describe('useSearchTabs', () => {
  it('keeps each tab’s filter separate', () => {
    const { result } = renderHook(() => useSearchTabs());
    const firstId = result.current.tabs[0].id;

    act(() => {
      result.current.setActiveTabQuery('a');
      result.current.setActiveTabFilter('ext:bat;cmd');
    });

    let secondId = '';
    act(() => {
      secondId = result.current.createTab('a', 'ext:mp4');
    });

    // The new tab carries its own filter...
    expect(result.current.tabs.find((tab) => tab.id === secondId)).toMatchObject({
      query: 'a',
      filterQuery: 'ext:mp4',
    });
    // ...and the previously active tab is untouched. This is the bug where opening a second
    // bookmark rewrote the first tab's filter.
    expect(result.current.tabs.find((tab) => tab.id === firstId)).toMatchObject({
      query: 'a',
      filterQuery: 'ext:bat;cmd',
    });
  });

  it('only rewrites the active tab when its filter changes', () => {
    const { result } = renderHook(() => useSearchTabs());
    const firstId = result.current.tabs[0].id;

    act(() => {
      result.current.setActiveTabFilter('folder:');
    });

    expect(result.current.tabs.find((tab) => tab.id === firstId)?.filterQuery).toBe('folder:');
  });
});
