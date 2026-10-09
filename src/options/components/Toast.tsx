import React from 'react';

interface Props {
  toast: { message: string; kind: 'success' | 'error' } | null;
}

export function Toast({ toast }: Props) {
  if (!toast) return null;
  return (
    <div id="toast" className={toast.kind} style={{ display: 'block', opacity: 1 }}>
      {toast.message}
    </div>
  );
}