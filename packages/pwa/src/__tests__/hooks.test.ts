/**
 * Tests for PWA React hooks (src/lib/hooks.ts).
 *
 * Uses @testing-library/react's renderHook to test hooks in isolation.
 */

import { vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCheckExpiry = vi.fn<() => Promise<boolean>>();
const mockPurgeAll = vi.fn<() => Promise<void>>();

vi.mock('@/lib/db', () => ({
  checkExpiry: () => mockCheckExpiry(),
  purgeAll: () => mockPurgeAll(),
}));

vi.mock('@/lib/sync', () => ({
  startAutoSync: vi.fn(),
  stopAutoSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import hooks under test
// ---------------------------------------------------------------------------

import { useOnlineStatus, usePurgeCheck } from '@/lib/hooks';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useOnlineStatus', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  it('returns true when navigator.onLine is true', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('returns false when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('updates when online event fires', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current).toBe(true);
  });

  it('updates when offline event fires', async () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        value: false,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current).toBe(false);
  });
});

describe('usePurgeCheck', () => {
  let replaceSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExpiry.mockResolvedValue(false);
    mockPurgeAll.mockResolvedValue(undefined);

    // Mock window.location.replace
    replaceSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { replace: replaceSpy, href: 'http://localhost/' },
      writable: true,
      configurable: true,
    });
  });

  it('fires on visibilitychange to "visible"', async () => {
    mockCheckExpiry.mockResolvedValue(false);

    renderHook(() => usePurgeCheck());

    // The hook also runs once on mount — wait for that
    await waitFor(() => {
      expect(mockCheckExpiry).toHaveBeenCalled();
    });

    mockCheckExpiry.mockClear();

    // Simulate visibility change
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      // Let async handlers settle
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(mockCheckExpiry).toHaveBeenCalled();
  });

  it('calls purgeAll when session is expired', async () => {
    mockCheckExpiry.mockResolvedValue(true);

    renderHook(() => usePurgeCheck());

    await waitFor(() => {
      expect(mockPurgeAll).toHaveBeenCalled();
    });
  });

  it('does NOT purge when session is valid', async () => {
    mockCheckExpiry.mockResolvedValue(false);

    renderHook(() => usePurgeCheck());

    // Wait for the mount check to complete
    await waitFor(() => {
      expect(mockCheckExpiry).toHaveBeenCalled();
    });

    expect(mockPurgeAll).not.toHaveBeenCalled();
  });

  it('redirects to "/" after purge', async () => {
    mockCheckExpiry.mockResolvedValue(true);

    renderHook(() => usePurgeCheck());

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/');
    });
  });
});
