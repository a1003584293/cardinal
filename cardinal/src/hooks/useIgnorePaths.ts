import { useCallback } from 'react';
import { useStoredState } from './useStoredState';

const STORAGE_KEY = 'cardinal.ignorePaths';
/// Set once the user edits the list; from then on the stored list is never migrated.
const USER_EDITED_KEY = 'cardinal.ignorePaths.userEdited';
// Ignore generated, disposable, or high-churn macOS paths by default:
// - `/Volumes` can include external drives and network mounts that are large or slow to traverse.
// - `~/Library/CloudStorage` can contain cloud stubs that trigger downloads or network I/O.
// - `~/Library/Biome` stores system suggestions/activity data rather than user-authored files.
// - `~/Library/Caches`, `~/Library/Logs`, and `~/Library/Metadata` are cache/log/metadata stores rather than user-authored files.
// - `/Library/Caches` and `/System/Library/Caches` are transient system caches with low search value.
// - `/private/var` is a broad system runtime area for temp files, caches, logs, and databases.
// - `/private/tmp` is a temporary-file area with very high churn and little search value.
const DEFAULT_IGNORE_PATHS = [
  '/Volumes',
  '~/Library/CloudStorage',
  '~/Library/Biome',
  '~/Library/Caches',
  '~/Library/Logs',
  '~/Library/Metadata',
  '/Library/Caches',
  '/System/Library/Caches',
  '/private/var',
  '/private/tmp',
];

const cleanPaths = (next: string[]): string[] =>
  next.map((item) => item.trim()).filter((item) => item.length > 0);

/**
 * Every path that has ever been a default. A stored list made up exclusively of these is an
 * older release's default list, not a user choice.
 */
const LEGACY_DEFAULT_IGNORE_PATHS = new Set<string>([
  // v1 defaults, saved by releases before `/Volumes` was ignored.
  '~/Library/CloudStorage',
  '~/Library/Biome',
  '~/Library/Caches',
  '~/Library/Logs',
  '~/Library/Metadata',
  '/Library/Caches',
  '/System/Library/Caches',
  '/private/var',
  '/private/tmp',
  ...DEFAULT_IGNORE_PATHS,
]);

/**
 * Merges newly added default ignore paths into a stored list left over from an older release.
 *
 * Without this an upgrade keeps indexing network volumes and caches: `/Volumes` is where
 * NFS/SMB shares live, and walking one of those takes minutes per directory. Only lists that
 * are entirely made of historical defaults are touched, so custom entries (and a
 * deliberately emptied list) are preserved.
 *
 * Returns the list to persist, or `null` when nothing needs to change.
 */
export function migrateStoredIgnorePaths(stored: string[], userEdited: boolean): string[] | null {
  if (userEdited) {
    return null;
  }
  // An empty list means the user removed everything on purpose.
  if (stored.length === 0) {
    return null;
  }
  const looksLikeOldDefaults = stored.every((path) => LEGACY_DEFAULT_IGNORE_PATHS.has(path));
  if (!looksLikeOldDefaults) {
    return null;
  }
  // Already covers every default: nothing new to add.
  if (DEFAULT_IGNORE_PATHS.every((path) => stored.includes(path))) {
    return null;
  }
  return [
    ...DEFAULT_IGNORE_PATHS,
    ...stored.filter((path) => !DEFAULT_IGNORE_PATHS.includes(path)),
  ];
}

/**
 * Runs the migration before `useStoredState` reads the value, so `start_logic` sees the
 * migrated list on the very first launch after the upgrade.
 */
function applyIgnorePathMigration(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const userEdited = window.localStorage.getItem(USER_EDITED_KEY) === 'true';
    if (userEdited) {
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) {
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }
    const stored = cleanPaths(parsed.filter((item): item is string => typeof item === 'string'));
    const migrated = migrateStoredIgnorePaths(stored, userEdited);
    if (migrated != null) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      console.info('Merged new default ignore paths into the saved list', migrated);
    }
  } catch (error) {
    console.warn('Unable to migrate saved ignore paths', error);
  }
}

export function useIgnorePaths() {
  // Synchronous and idempotent: must run before the stored value is read.
  applyIgnorePathMigration();

  const [ignorePaths, setIgnorePathsState] = useStoredState<string[]>({
    key: STORAGE_KEY,
    defaultValue: DEFAULT_IGNORE_PATHS,
    read: (raw) => {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return cleanPaths(parsed.filter((item): item is string => typeof item === 'string'));
    },
    write: (value) => JSON.stringify(value),
    readErrorMessage: 'Unable to read saved ignore paths',
    writeErrorMessage: 'Unable to persist default ignore paths',
  });

  const setIgnorePaths = useCallback(
    (next: string[]) => {
      const cleaned = cleanPaths(next);
      // Any explicit edit opts out of future default-list migrations.
      try {
        window.localStorage.setItem(USER_EDITED_KEY, 'true');
      } catch (error) {
        console.warn('Unable to persist ignore paths edit marker', error);
      }
      setIgnorePathsState(cleaned);
    },
    [setIgnorePathsState],
  );

  return { ignorePaths, setIgnorePaths, defaultIgnorePaths: DEFAULT_IGNORE_PATHS };
}
