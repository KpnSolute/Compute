import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 640): boolean {
  const [mobile, setMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent | { matches: boolean }) => setMobile(e.matches);
    setMobile(mq.matches);
    mq.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
    return () => mq.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
  }, [breakpoint]);
  return mobile;
}
