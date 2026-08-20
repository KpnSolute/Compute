import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ComputeLanding } from './ComputeHome';


describe('KpnCompute product landing', () => {
  it('sends signed-out users to Platform and never presents a provider origin', () => {
    const html = renderToStaticMarkup(
      <ComputeLanding
        user={null}
        onOpenConsole={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(html).toContain('Log into Platform');
    expect(html).toContain('https://platform.kpnsolute.com/compute');
    expect(html).not.toContain('onrender.com');
    expect(html).not.toContain('Sign in to the console');
  });
});
