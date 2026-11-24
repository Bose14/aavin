import type { ReactNode } from 'react';

/** Standard page wrapper: same padding, max width and spacing on every screen. */
export function Page({ children, width = 'standard' }: { children: ReactNode; width?: 'standard' | 'narrow' }) {
  return <div className={`page${width === 'narrow' ? ' page--narrow' : ''}`}>{children}</div>;
}

/** Standard page header: one title style, optional subtitle, actions on the right. */
export function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
