import React from 'react';

interface Props {
  id: string;
  children: React.ReactNode;
}

export function Help({ id, children }: Props) {
  return (
    <>
      <button
        className="help-btn"
        aria-expanded={false}
        aria-controls={`help-${id}`}
        data-help={id}
        title="More info"
      >
        ?
      </button>
      <div className="help-panel" id={`help-${id}`} hidden>
        {children}
      </div>
    </>
  );
}