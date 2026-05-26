'use client';

import { useEffect, useRef, useState } from 'react';

interface LogEvent {
  container: string;
  stream: 'stdout' | 'stderr';
  line: string;
  ts: number;
}

export function LogViewer({ serviceId }: { serviceId: string }) {
  const [lines, setLines] = useState<LogEvent[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/services/${serviceId}/logs/stream?tail=200`, { withCredentials: true });
    es.addEventListener('log', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as Omit<LogEvent, 'ts'>;
        setLines((prev) => {
          const next = [...prev, { ...payload, ts: Date.now() }];
          return next.length > 2000 ? next.slice(-2000) : next;
        });
      } catch {
        /* ignore */
      }
    });
    es.addEventListener('error', () => { /* EventSource auto-reconnects */ });
    return () => es.close();
  }, [serviceId]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div
      ref={ref}
      className="mono text-xs bg-(--color-bg) border border-(--color-border) rounded p-3 h-[480px] overflow-auto whitespace-pre-wrap"
    >
      {lines.length === 0 ? (
        <span className="text-(--color-muted)">waiting for logs…</span>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={l.stream === 'stderr' ? 'text-(--color-error)' : ''}>
            <span className="text-(--color-muted) mr-2">{l.container}</span>
            {l.line.replace(/\n$/, '')}
          </div>
        ))
      )}
    </div>
  );
}
