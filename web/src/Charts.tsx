// Small hand-rolled SVG charts — no charting library dependency. Unlike
// WebAuthn (large, security-critical, easy to get subtly wrong), a bar
// chart is simple enough geometry that hand-rolling it is the right call,
// not a shortcut: a handful of <rect>s, no crypto, no protocol surface.

interface StackedBarChartProps {
  data: { label: string; segments: { key: string; value: number; color: string }[] }[];
  height?: number;
  labelEvery?: number;
}

export function StackedBarChart({ data, height = 140, labelEvery = 1 }: StackedBarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)));
  const barWidth = 100 / data.length;

  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
        {data.map((d, i) => {
          const total = d.segments.reduce((sum, s) => sum + s.value, 0);
          let cursor = height;
          return (
            <g key={i}>
              {d.segments.map((s, si) => {
                const segHeight = total > 0 ? (s.value / max) * (height - 4) : 0;
                cursor -= segHeight;
                return (
                  <rect
                    key={si}
                    x={i * barWidth + barWidth * 0.15}
                    y={cursor}
                    width={barWidth * 0.7}
                    height={segHeight}
                    fill={s.color}
                  >
                    <title>
                      {d.label}: {s.key}={s.value}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", fontSize: 9, color: "var(--text-dim)", marginTop: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ width: `${barWidth}%`, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {i % labelEvery === 0 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

interface BarChartProps {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
}

export function BarChart({ data, height = 140, color = "var(--accent)" }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = 100 / data.length;
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }}>
        {data.map((d, i) => {
          const barHeight = (d.value / max) * (height - 4);
          return (
            <rect
              key={i}
              x={i * barWidth + barWidth * 0.15}
              y={height - barHeight}
              width={barWidth * 0.7}
              height={barHeight}
              fill={color}
              rx={1}
            >
              <title>
                {d.label}: {d.value}
              </title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: "flex", fontSize: 9, color: "var(--text-dim)", marginTop: 4 }}>
        {data.map((d, i) => (
          <div key={i} style={{ width: `${barWidth}%`, textAlign: "center", overflow: "hidden" }}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>
      {items.map((it) => (
        <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: it.color, display: "inline-block" }} />
          {it.label}
        </div>
      ))}
    </div>
  );
}
