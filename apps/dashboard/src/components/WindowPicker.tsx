interface Props {
  idx: number;
  onChange: (idx: number) => void;
  /** The options this page offers: a time window on the series pages, a statistics range on Cost. */
  options: { label: string }[];
  /** What the control means here — "时间窗" or "统计范围". */
  label?: string;
}

export function WindowPicker({ idx, onChange, options, label }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' }}>
      {label && (
        <span style={{ fontSize: 11, color: '#7c8aa0', whiteSpace: 'nowrap', flex: '0 0 auto' }}>{label}</span>
      )}
      <div style={{ display: 'flex', gap: 4, background: '#141a26', padding: 3, borderRadius: 8, overflowX: 'auto', maxWidth: '100%' }}>
        {options.map((w, i) => (
          <button
            key={w.label}
            onClick={() => onChange(i)}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
              color: i === idx ? '#0b0e14' : '#9fb0c8',
              background: i === idx ? '#4fc3f7' : 'transparent',
            }}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
