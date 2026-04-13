import type { ReactNode } from 'react';
import { Rocket } from 'lucide-react';

interface PlaceholderViewProps {
  icon?: ReactNode;
  title: string;
  description: string;
}

/**
 * Generic "coming soon" placeholder for views whose backend has shipped
 * but whose UI is still under construction.
 */
export function PlaceholderView({ icon, title, description }: PlaceholderViewProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div
          className="card p-10 text-center"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            borderRadius: 16,
          }}
        >
          <div
            className="mx-auto mb-5 w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{
              background: 'rgba(217, 119, 6, 0.1)',
              color: '#D97706',
            }}
          >
            {icon ?? <Rocket size={28} />}
          </div>
          <h1
            className="text-2xl font-semibold mb-3 tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {title}
          </h1>
          <p
            className="text-sm leading-relaxed mb-6 max-w-md mx-auto"
            style={{ color: 'var(--text-secondary)' }}
          >
            {description}
          </p>
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: 'rgba(217, 119, 6, 0.12)',
              color: '#D97706',
              border: '1px solid rgba(217, 119, 6, 0.25)',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: '#D97706' }}
            />
            Coming soon &mdash; UI building in progress
          </div>
          <p
            className="text-2xs mt-5 opacity-70"
            style={{ color: 'var(--text-tertiary)' }}
          >
            The backend for this feature has shipped. The dashboard is being built next.
          </p>
        </div>
      </div>
    </div>
  );
}
