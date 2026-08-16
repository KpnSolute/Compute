import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullSheet } from './PullSheet';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getInventory: vi.fn(),
  },
}));

const getInventory = vi.mocked(api.getInventory);

const user = {
  id: 'pull-sheet-test-user',
  username: 'manager',
  display_name: 'Test Manager',
  last_name: 'Manager',
  role: 'manager' as const,
};

describe('PullSheet', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    getInventory.mockResolvedValue({
      items: [{
        sku: 'SKU-1',
        desc: 'Test Apple Juice',
        category: 'Beverages',
        unit: 'Case',
        price: 12.5,
        closingQty: 3,
        par: 0,
      }],
    } as never);
    await act(async () => {
      root = createRoot(host);
      root.render(<PullSheet user={user} initialMonth={7} initialYear={2026} />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    getInventory.mockReset();
  });

  it('renders a bounded, focusable review region with labelled pull inputs', () => {
    const region = host.querySelector('[role="region"]');
    const pullInput = host.querySelector<HTMLInputElement>('.pull-qty-input');

    expect(region).not.toBeNull();
    expect(region?.classList.contains('pull-table-scroll')).toBe(true);
    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(region?.getAttribute('aria-label')).toContain('1 rows');
    expect(pullInput?.getAttribute('aria-label')).toBe('Pull quantity for Test Apple Juice');
    expect(host.querySelector('tbody td:nth-child(6)')?.textContent).toBe('0');
    expect(host.textContent).toContain('End of list');
  });

  it('switches to compact mode while preserving an accessible scroll region', async () => {
    const compact = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Compact');

    expect(compact).not.toBeUndefined();
    await act(async () => {
      compact?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.querySelector('.pull-sheet-compact')).not.toBeNull();
    expect(compact?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[role="region"]')?.classList.contains('pull-table-scroll')).toBe(true);
    expect(host.querySelector<HTMLInputElement>('.pull-qty-input')?.getAttribute('aria-label'))
      .toBe('Week 1 pull quantity for Test Apple Juice');
  });
});
