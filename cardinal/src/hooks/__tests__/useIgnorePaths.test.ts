import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateStoredIgnorePaths, useIgnorePaths } from '../useIgnorePaths';

const STORAGE_KEY = 'cardinal.ignorePaths';
const USER_EDITED_KEY = 'cardinal.ignorePaths.userEdited';
const EXPECTED_DEFAULT_IGNORE_PATHS = [
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

const flushEffects = async () => {
  await act(async () => {});
};

describe('useIgnorePaths', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates from stored values and filters invalid entries', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([' /tmp ', '', 42, '   ', '/var']));
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useIgnorePaths());

    expect(result.current.ignorePaths).toEqual(['/tmp', '/var']);

    await flushEffects();

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('uses defaults and persists when no stored value exists', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useIgnorePaths());

    expect(result.current.ignorePaths).toEqual(EXPECTED_DEFAULT_IGNORE_PATHS);
    expect(result.current.defaultIgnorePaths).toEqual(EXPECTED_DEFAULT_IGNORE_PATHS);

    await flushEffects();

    expect(setItemSpy).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(EXPECTED_DEFAULT_IGNORE_PATHS),
    );
  });

  it('includes cache, biome, logs, metadata, and system runtime folders in default ignore paths', () => {
    const { result } = renderHook(() => useIgnorePaths());

    expect(result.current.defaultIgnorePaths).toContain('~/Library/CloudStorage');
    expect(result.current.defaultIgnorePaths).toContain('~/Library/Caches');
    expect(result.current.defaultIgnorePaths).toContain('/Library/Caches');
    expect(result.current.defaultIgnorePaths).toContain('/System/Library/Caches');
    expect(result.current.defaultIgnorePaths).toContain('~/Library/Biome');
    expect(result.current.defaultIgnorePaths).toContain('~/Library/Logs');
    expect(result.current.defaultIgnorePaths).toContain('~/Library/Metadata');
    expect(result.current.defaultIgnorePaths).toContain('/private/var');
    expect(result.current.defaultIgnorePaths).toContain('/private/tmp');
  });

  it('keeps an empty stored array without writing defaults', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['', '   ']));
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useIgnorePaths());

    expect(result.current.ignorePaths).toEqual([]);

    await flushEffects();

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('cleans and persists updates', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useIgnorePaths());

    await flushEffects();

    act(() => {
      result.current.setIgnorePaths([' /tmp ', '', '/var', '   ']);
    });

    expect(result.current.ignorePaths).toEqual(['/tmp', '/var']);
    expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(['/tmp', '/var']));
  });

  it('adds /Volumes to a stored list saved by an older release', async () => {
    // Exactly the v1 defaults: `/Volumes` (network/external mounts) was missing, so the whole
    // disk walk descended into every NFS share.
    const legacyDefaults = EXPECTED_DEFAULT_IGNORE_PATHS.filter((path) => path !== '/Volumes');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyDefaults));

    const { result } = renderHook(() => useIgnorePaths());

    expect(result.current.ignorePaths).toEqual(EXPECTED_DEFAULT_IGNORE_PATHS);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify(EXPECTED_DEFAULT_IGNORE_PATHS),
    );
  });

  it('never migrates after the user edited the list', async () => {
    const legacyDefaults = EXPECTED_DEFAULT_IGNORE_PATHS.filter((path) => path !== '/Volumes');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyDefaults));
    window.localStorage.setItem(USER_EDITED_KEY, 'true');

    const { result } = renderHook(() => useIgnorePaths());

    expect(result.current.ignorePaths).toEqual(legacyDefaults);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(legacyDefaults));
  });

  it('keeps custom ignore entries while adding new defaults', () => {
    const legacyDefaults = EXPECTED_DEFAULT_IGNORE_PATHS.filter((path) => path !== '/Volumes');
    // A purely-defaults list plus nothing custom is the migration case; a list with custom
    // entries is left alone so user intent wins.
    expect(migrateStoredIgnorePaths([...legacyDefaults, '/data/tmp'], false)).toBeNull();
    expect(migrateStoredIgnorePaths([...legacyDefaults], false)).toEqual(
      EXPECTED_DEFAULT_IGNORE_PATHS,
    );
    expect(migrateStoredIgnorePaths([], false)).toBeNull();
    expect(migrateStoredIgnorePaths(['/data/tmp'], false)).toBeNull();
    // Already current: no rewrite.
    expect(migrateStoredIgnorePaths(EXPECTED_DEFAULT_IGNORE_PATHS, false)).toBeNull();
    // User edited the list: never migrate.
    expect(migrateStoredIgnorePaths(legacyDefaults, true)).toBeNull();
  });

  it('falls back to defaults when stored JSON is invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem(STORAGE_KEY, '{');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result } = renderHook(() => useIgnorePaths());

    expect(result.current.ignorePaths).toEqual(result.current.defaultIgnorePaths);

    await flushEffects();

    expect(setItemSpy).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(result.current.defaultIgnorePaths),
    );
    warnSpy.mockRestore();
  });
});
