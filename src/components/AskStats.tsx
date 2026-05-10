'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

type ChatRole = 'user' | 'assistant';

type ToolCall = {
  name: string;
  input: Record<string, unknown>;
  result: ToolResult;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
};

type ToolResult = Record<string, unknown> & {
  display?: {
    mode?: 'stat_card' | 'ranking' | 'table' | 'compact_table' | 'weapon_build';
    title?: string;
    columns?: string[];
    maxRows?: number;
    primary?: Record<string, unknown>;
  };
  chart?: ChartSpec;
  rows?: Record<string, unknown>[];
};

type ChartPoint = Record<string, string | number | null | undefined>;

type ChartSpec = {
  type?: 'line' | 'bar';
  title?: string;
  xKey?: string;
  yKey?: string;
  data?: ChartPoint[];
  series?: { name: string; data: ChartPoint[] }[];
};

const EXAMPLE_GROUPS = [
  {
    title: 'Player Statistics',
    examples: [
      'Who has the highest K/D over the last 10 games?',
      "What was Nic's win percentage in April?",
      'How many wins did Nic and Jamal get together this week?',
      "What was Jamal's best session ever?",
    ],
  },
  {
    title: 'Weapon Statistics',
    examples: [
      "What's the TTK of the SCW-10 vs CZA13?",
      "What's the best LMG for long range with good control?",
      "What's the best SCW-10 build for close range?",
      'Show me the SCW-10 damage profile.',
    ],
  },
];

function formatValue(value: unknown, key = ''): string {
  if (typeof value === 'number') {
    if (key === 'score') return value.toFixed(1);
    if ((key.includes('rate') || key.includes('pct')) && value >= 0 && value <= 1) {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (!Number.isInteger(value)) return value.toFixed(2);
    return value.toLocaleString();
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function isDisplayScalar(value: unknown): boolean {
  return ['string', 'number', 'boolean'].includes(typeof value) || value == null;
}

const CHART_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#22d3ee'];

function ResultChart({ chart }: { chart?: ChartSpec }) {
  if (!chart) return null;
  const xKey = chart.xKey || 'label';
  const yKey = chart.yKey || 'value';

  if (chart.type === 'line' && chart.series?.length) {
    const distances = new Set<number>();
    for (const series of chart.series) {
      for (const point of series.data) {
        const x = Number(point[xKey]);
        if (Number.isFinite(x)) distances.add(x);
      }
    }
    const data = [...distances].sort((a, b) => a - b).map((distance) => {
      const row: ChartPoint = { [xKey]: distance };
      for (const series of chart.series || []) {
        const point = series.data.find((candidate) => Number(candidate[xKey]) === distance);
        row[series.name] = point ? Number(point[yKey]) : null;
      }
      return row;
    });

    return (
      <div className="mt-3 rounded-lg border border-border/70 bg-bg-primary/60 p-3">
        {chart.title && <div className="mb-2 text-[10px] uppercase tracking-wider text-text-muted">{chart.title}</div>}
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} unit="m" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} unit="ms" />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              {chart.series.map((series, index) => (
                <Line
                  key={series.name}
                  type="monotone"
                  dataKey={series.name}
                  stroke={CHART_COLORS[index % CHART_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (chart.type === 'bar' && chart.data?.length) {
    return (
      <div className="mt-3 rounded-lg border border-border/70 bg-bg-primary/60 p-3">
        {chart.title && <div className="mb-2 text-[10px] uppercase tracking-wider text-text-muted">{chart.title}</div>}
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Bar dataKey={yKey} fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return null;
}

function ResultTable({
  rows,
  columns: preferredColumns,
  maxRows,
}: {
  rows: Record<string, unknown>[];
  columns?: string[];
  maxRows?: number;
}) {
  const columns = useMemo(() => {
    if (preferredColumns?.length) return preferredColumns;
    const keys = new Set<string>();
    for (const row of rows.slice(0, maxRows || 5)) {
      for (const key of Object.keys(row)) {
        if (isDisplayScalar(row[key])) keys.add(key);
      }
    }
    return [...keys].slice(0, 8);
  }, [rows, preferredColumns, maxRows]);

  if (rows.length === 0 || columns.length === 0) return null;

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border/70">
      <table className="min-w-full text-xs">
        <thead className="bg-bg-primary/80 text-text-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left font-mono uppercase tracking-wider">
                {column.replaceAll('_', ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.slice(0, maxRows || 5).map((row, index) => (
            <tr key={index} className="bg-bg-card/40">
              {columns.map((column) => (
                <td key={column} className="px-3 py-2 text-text-secondary tabular-nums">
                  {formatValue(row[column], column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultCard({ result }: { result: Record<string, unknown> }) {
  const toolResult = result as ToolResult;
  const display = toolResult.display;
  const chart = toolResult.chart;
  const rows = Array.isArray(toolResult.rows) ? toolResult.rows : null;
  const primary = display?.primary || (rows?.length === 1 ? rows[0] : null);

  if ((display?.mode === 'stat_card' || display?.mode === 'ranking') && primary && display.mode === 'stat_card') {
    const entries = Object.entries(primary).filter(
      ([key, value]) =>
        isDisplayScalar(value) &&
        !['unsupported', 'reason', 'start', 'end', 'player_name', 'period', 'metric_value'].includes(key)
    );

    return (
      <>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {entries.slice(0, 6).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-border/70 bg-bg-primary/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">{key.replaceAll('_', ' ')}</div>
              <div className="mt-1 text-lg font-bold text-text-primary tabular-nums">{formatValue(value, key)}</div>
            </div>
          ))}
        </div>
        <ResultChart chart={chart} />
      </>
    );
  }

  if (display?.mode === 'weapon_build' && primary) {
    const attachments = Array.isArray(primary.attachments) ? primary.attachments : [];
    const notes = Array.isArray(result.practical_notes) ? result.practical_notes : [];
    return (
      <>
      <div className="mt-3 rounded-lg border border-border/70 bg-bg-primary/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-muted">{display.title || 'Recommended build'}</div>
            <div className="mt-1 text-2xl font-bold text-text-primary tabular-nums">
              {formatValue(primary.score, 'score')}
            </div>
          </div>
          <div className="text-right text-xs text-text-muted">
            <div>{formatValue(primary.avg_ttk_ms, 'avg_ttk_ms')} avg TTK</div>
            <div>{formatValue(primary.ads_ms, 'ads_ms')} ADS</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span key={String(attachment)} className="rounded border border-border bg-bg-card px-2 py-1 text-xs text-text-secondary">
              {String(attachment)}
            </span>
          ))}
        </div>
        {notes.length > 0 && (
          <div className="mt-3 space-y-1 rounded border border-accent-gold/25 bg-accent-gold/10 px-3 py-2 text-xs text-text-secondary">
            {notes.map((note) => (
              <div key={String(note)}>{String(note)}</div>
            ))}
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(display.columns || []).slice(1, 4).map((column) => (
            <div key={column} className="rounded border border-border/60 bg-bg-card/70 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-text-muted">{column.replaceAll('_', ' ')}</div>
              <div className="text-sm font-semibold text-text-primary tabular-nums">{formatValue(primary[column], column)}</div>
            </div>
          ))}
        </div>
      </div>
      <ResultChart chart={chart} />
      </>
    );
  }

  if (rows) {
    return (
      <>
        <ResultChart chart={chart} />
        <ResultTable
          rows={rows}
          columns={display?.columns}
          maxRows={display?.maxRows}
        />
      </>
    );
  }

  const entries = Object.entries(result).filter(
    ([key, value]) =>
      isDisplayScalar(value) &&
      !['unsupported', 'reason', 'start', 'end', 'player_name', 'period'].includes(key)
  );

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="rounded-lg border border-border/70 bg-bg-primary/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-text-muted">{key.replaceAll('_', ' ')}</div>
          <div className="mt-1 text-lg font-bold text-text-primary tabular-nums">{formatValue(value, key)}</div>
        </div>
      ))}
    </div>
  );
}

function ToolTrace({ toolCalls }: { toolCalls?: ToolCall[] }) {
  if (!toolCalls || toolCalls.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {toolCalls.map((call, index) => (
        <div key={`${call.name}_${index}`}>
          {!call.result.unsupported && <ResultCard result={call.result} />}
          <details className="mt-2">
            <summary className="cursor-pointer select-none font-mono text-[11px] text-text-muted hover:text-text-secondary">
              Source: {call.name}
            </summary>
            <div className="mt-1 break-all rounded border border-border/60 bg-bg-primary/50 px-2 py-1 font-mono text-[10px] text-text-muted">
              {JSON.stringify(call.input)}
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

function newId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

type PendingAsk = {
  id: number;
  question: string;
};

export default function AskStats({ pendingAsk }: { pendingAsk?: PendingAsk | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const handledPendingAskRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const ask = useCallback(async (nextInput?: string) => {
    const question = (nextInput ?? input).trim();
    if (!question || loading) return;

    const userMessage: ChatMessage = { id: newId(), role: 'user', content: question };
    const assistantId = newId();
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setInput('');
    setLoading(true);

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          timezone,
          history: messages.slice(-12).map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(await response.text());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const line = chunk.split('\n').find((entry) => entry.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));

          if (event.type === 'delta') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${event.text}` }
                  : message
              )
            );
          }

          if (event.type === 'done') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, toolCalls: event.toolCalls } : message
              )
            );
          }

          if (event.type === 'error') throw new Error(event.error);
        }
      }
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: error instanceof Error ? error.message : 'Ask failed.',
              }
            : message
        )
      );
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  useEffect(() => {
    if (!pendingAsk || handledPendingAskRef.current === pendingAsk.id) return;
    handledPendingAskRef.current = pendingAsk.id;
    void ask(pendingAsk.question);
  }, [ask, pendingAsk]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask();
  }

  return (
    <div className="space-y-4">
      <div className="ask-shell">
        <div className="ask-panel">
          <div className="ask-inner">
            <div className="border-b border-border/80 px-4 py-4 bg-bg-card/75 backdrop-blur-sm">
              <div>
                <h2 className="text-base font-semibold text-text-primary">Ask Player & Weapon Stats</h2>
                <p className="mt-1 text-xs text-text-muted">
                  Natural-language player and weapon questions, answered only through deterministic server tools.
                </p>
              </div>
            </div>

        <div className="h-[58vh] min-h-[420px] overflow-y-auto p-4 space-y-4 bg-bg-primary/30 recon-grid">
          {messages.length === 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {EXAMPLE_GROUPS.map((group) => (
                <section key={group.title} className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    {group.title}
                  </div>
                  <div className="grid gap-2">
                    {group.examples.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => void ask(example)}
                        className="ask-template-card text-left rounded-lg border border-border bg-bg-card/80 px-3 py-3 text-sm text-text-secondary hover:text-text-primary hover:border-accent-gold/50 transition-colors"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                'rounded-lg border px-4 py-3',
                message.role === 'user'
                  ? 'ml-auto max-w-[85%] border-accent-gold/30 bg-accent-gold/10 text-text-primary'
                  : 'mr-auto max-w-[95%] border-border bg-bg-card text-text-secondary'
              )}
            >
              <div className="whitespace-pre-wrap text-sm leading-6">
                {message.content || (loading && message.role === 'assistant' ? 'Checking stats...' : '')}
              </div>
              {message.role === 'assistant' && <ToolTrace toolCalls={message.toolCalls} />}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={submit} className="border-t border-border/80 bg-bg-card/90 p-3 backdrop-blur-sm">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about K/D, wins, sessions, squadmates, or weapons..."
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary/95 px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent-gold focus:shadow-[0_0_0_3px_rgba(245,158,11,0.12)]"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-lg border border-accent-gold/50 bg-accent-gold px-4 py-2 text-sm font-semibold text-bg-primary shadow-[0_0_22px_rgba(245,158,11,0.18)] transition-colors hover:bg-accent-amber disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ask
            </button>
          </div>
        </form>
          </div>
        </div>
      </div>
    </div>
  );
}
