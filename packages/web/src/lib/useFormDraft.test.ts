import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFormDraft } from './useFormDraft';

describe('useFormDraft', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('starts from the initial value when no draft exists, and reports hadDraft=false', () => {
    const { result } = renderHook(() => useFormDraft('draft:test:a', { name: '' }));
    expect(result.current[0]).toEqual({ name: '' });
    expect(result.current[3]).toBe(false);
  });

  it('reports hadDraft=true when a draft was restored on mount', () => {
    localStorage.setItem('draft:test:e', JSON.stringify({ name: 'resumed' }));
    const { result } = renderHook(() => useFormDraft('draft:test:e', { name: '' }));
    expect(result.current[0]).toEqual({ name: 'resumed' });
    expect(result.current[3]).toBe(true);
  });

  it('persists changes to localStorage and restores them on remount (simulating navigation away and back)', () => {
    const { result, unmount } = renderHook(() => useFormDraft('draft:test:b', { name: '' }));
    act(() => {
      result.current[1]({ name: 'half-typed input' });
    });
    unmount();

    const { result: result2 } = renderHook(() => useFormDraft('draft:test:b', { name: '' }));
    expect(result2.current[0]).toEqual({ name: 'half-typed input' });
  });

  it('clearDraft() removes the persisted value so a fresh mount falls back to initial', () => {
    const { result, unmount } = renderHook(() => useFormDraft('draft:test:c', { name: '' }));
    act(() => {
      result.current[1]({ name: 'will be discarded' });
    });
    act(() => {
      result.current[2](); // clearDraft
    });
    unmount();

    const { result: result2 } = renderHook(() => useFormDraft('draft:test:c', { name: 'reset' }));
    expect(result2.current[0]).toEqual({ name: 'reset' });
  });

  it('a corrupt draft in localStorage falls back to the initial value instead of throwing', () => {
    localStorage.setItem('draft:test:d', 'not valid json{{{');
    const { result } = renderHook(() => useFormDraft('draft:test:d', { name: 'fallback' }));
    expect(result.current[0]).toEqual({ name: 'fallback' });
  });
});
