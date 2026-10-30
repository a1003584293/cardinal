import { useCallback, useState } from 'react';

export type SearchTab = {
  id: string;
  query: string;
  // Filter fragment (e.g. `ext:mp4;mkv`) owned by this tab, so switching tabs restores the
  // filter as well as the text query.
  filterQuery: string;
};

let tabSequence = 0;
const nextTabId = (): string => {
  tabSequence += 1;
  return `tab-${tabSequence.toString(36)}-${Date.now().toString(36)}`;
};

export type SearchTabsController = {
  tabs: SearchTab[];
  activeTabId: string;
  activeTab: SearchTab;
  createTab: (query?: string, filterQuery?: string) => string;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  setActiveTabQuery: (query: string) => void;
  setActiveTabFilter: (filterQuery: string) => void;
};

/**
 * Manages multiple search tabs. Each tab carries its own query and filter; the active tab's
 * values feed the search bar. Search execution is orchestrated by the caller
 * (App reacts to `activeTabId` changes).
 */
export function useSearchTabs(): SearchTabsController {
  const [initialTab] = useState<SearchTab>(() => ({ id: nextTabId(), query: '', filterQuery: '' }));
  const [tabs, setTabs] = useState<SearchTab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTab.id);

  const createTab = useCallback((query = '', filterQuery = ''): string => {
    const id = nextTabId();
    setTabs((prev) => [...prev, { id, query, filterQuery }]);
    setActiveTabId(id);
    return id;
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id);
      if (index < 0) {
        return;
      }
      const remaining = tabs.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const fresh = { id: nextTabId(), query: '', filterQuery: '' };
        setTabs([fresh]);
        setActiveTabId(fresh.id);
        return;
      }
      setTabs(remaining);
      if (id === activeTabId) {
        const nextActive = remaining[Math.min(index, remaining.length - 1)];
        setActiveTabId(nextActive.id);
      }
    },
    [activeTabId, tabs],
  );

  const activateTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const setActiveTabQuery = useCallback(
    (query: string) => {
      setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, query } : tab)));
    },
    [activeTabId],
  );

  const setActiveTabFilter = useCallback(
    (filterQuery: string) => {
      setTabs((prev) =>
        prev.map((tab) => (tab.id === activeTabId ? { ...tab, filterQuery } : tab)),
      );
    },
    [activeTabId],
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    activateTab,
    setActiveTabQuery,
    setActiveTabFilter,
  };
}
