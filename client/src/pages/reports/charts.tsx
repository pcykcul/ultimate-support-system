/**
 * Pure-SVG / plain-div charts — no chart libraries (constitution: simple, readable IR).
 * Marks carry the series colors; every piece of text stays in the gray text tokens.
 */
import React, { useEffect, useRef, useState } from 'react';
import { fmtDay, SERIES } from './shared';

/** Track the rendered width of a container so SVG charts draw at true pixel size. */
function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Round a raw maximum up to a clean axis ceiling (1/2/5 × 10^k steps, min 1 — counts are integers). */
function niceScale(rawMax: number, tickCount: number): { max: number; step: number } {
  const target = Math.max(rawMax, 1) / tickCount;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const n = target / pow;
  const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
  return { max: step * Math.ceil(Math.max(rawMax, 1) / step), step };
}

/** Bar with a 4px-max rounded data-end and a square baseline. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    'Z',
  ].join(' ');
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

// ---------- Created vs solved, per day ----------

export function ByDayChart({ data }: { data: { date: string; created: number; solved: number }[] }) {
  const [ref, containerW] = useContainerWidth<HTMLDivElement>();
  const M = { top: 8, right: 8, bottom: 22, left: 36 };
  const height = 240;
  const minSlot = 10; // px per day — beyond this the chart scrolls horizontally
  const width = Math.max(containerW || 640, data.length * minSlot + M.left + M.right);
  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;

  const rawMax = Math.max(1, ...data.map((d) => Math.max(d.created, d.solved)));
  const { max: yMax, step } = niceScale(rawMax, 4);
  const y = (v: number) => M.top + innerH - (v / yMax) * innerH;

  const slot = data.length > 0 ? innerW / data.length : innerW;
  const barW = Math.max(2, Math.min(24, (slot - 6) / 2));
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  const ticks: number[] = [];
  for (let v = step; v <= yMax; v += step) ticks.push(v);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 mb-2">
        <LegendSwatch color={SERIES.created} label="Created" />
        <LegendSwatch color={SERIES.solved} label="Solved" />
      </div>
      <div ref={ref} className="overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="Tickets created and solved per day">
          {/* hairline gridlines + clean tick labels (muted, recessive) */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={M.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#9ca3af">
                {v.toLocaleString()}
              </text>
            </g>
          ))}
          {/* baseline */}
          <line
            x1={M.left}
            x2={width - M.right}
            y1={M.top + innerH}
            y2={M.top + innerH}
            stroke="#d1d5db"
            strokeWidth={1}
          />

          {data.map((d, i) => {
            const slotX = M.left + i * slot;
            const pairW = barW * 2 + 2; // 2px surface gap between the two bars
            const x0 = slotX + (slot - pairW) / 2;
            const hc = (d.created / yMax) * innerH;
            const hs = (d.solved / yMax) * innerH;
            return (
              <g key={d.date}>
                {d.created > 0 && (
                  <path d={topRoundedRect(x0, y(d.created), barW, hc, 4)} fill={SERIES.created} />
                )}
                {d.solved > 0 && (
                  <path d={topRoundedRect(x0 + barW + 2, y(d.solved), barW, hs, 4)} fill={SERIES.solved} />
                )}
                {i % labelEvery === 0 && (
                  <text
                    x={slotX + slot / 2}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#9ca3af"
                  >
                    {fmtDay(d.date)}
                  </text>
                )}
                {/* full-slot hover target with a native tooltip — bigger than the marks */}
                <rect
                  x={slotX}
                  y={M.top}
                  width={slot}
                  height={innerH}
                  className="fill-transparent hover:fill-gray-900/5"
                >
                  <title>{`${fmtDay(d.date)} — ${d.created} created · ${d.solved} solved`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ---------- Channel mix (single measure → single hue; length carries magnitude) ----------

export function ByChannelBars({ data }: { data: { channel: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="space-y-2.5">
      {data.map((d) => (
        <div
          key={d.channel}
          className="flex items-center gap-3"
          title={`${d.count.toLocaleString()} ticket${d.count === 1 ? '' : 's'} via ${d.channel}`}
        >
          <span className="w-16 shrink-0 text-xs text-gray-500 capitalize">{d.channel}</span>
          <div className="flex-1 h-4 rounded bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded"
              style={{ width: `${Math.max((d.count / max) * 100, 1.5)}%`, background: SERIES.created }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-xs text-gray-700 tabular-nums">
            {d.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
