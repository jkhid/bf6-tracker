import { supabase } from './supabase';
import { getTrackedPlayers } from './player-store';
import { buildSessionsFromEvents, GameEventRow, PlayerGameDelta } from './session-events';
import {
  applyAttachments,
  AttachmentMod,
  averageTtk,
  buildScore,
  rangeBandFromText,
  ttkAtDistance,
  Weapon,
} from './weapon-math';
import { loadWeaponDataset } from './weapon-source';

export const STAT_METRICS = [
  'matches',
  'kills',
  'kills_per_match',
  'deaths',
  'deaths_per_match',
  'wins',
  'losses',
  'kd',
  'win_rate',
  'damage',
  'damage_per_match',
  'damage_per_minute',
  'kpm',
  'headshot_kills',
  'headshot_pct',
  'revives',
  'revives_per_match',
  'vehicle_kills',
  'playtime_minutes',
] as const;

type StatMetric = (typeof STAT_METRICS)[number];
type Direction = 'best' | 'worst';

type ToolSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

export type StatsTool = {
  name: string;
  description: string;
  input_schema: ToolSchema;
  handler: (input: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
};

export type ToolContext = {
  timezone: string;
  now?: Date;
};

export type ToolResult = Record<string, unknown> & {
  unsupported?: boolean;
  reason?: string;
  display?: {
    mode: 'stat_card' | 'ranking' | 'table' | 'compact_table' | 'weapon_build';
    title?: string;
    columns?: string[];
    maxRows?: number;
    primary?: Record<string, unknown>;
  };
  chart?: Record<string, unknown>;
};

type PlayerRef = {
  name: string;
  displayName: string;
};

type DateRange = {
  start?: string;
  end?: string;
  label: string;
};

type Aggregates = {
  matches: number;
  kills: number;
  deaths: number;
  wins: number;
  losses: number;
  damage: number;
  headshot_kills: number;
  revives: number;
  vehicle_kills: number;
  seconds: number;
};

type SessionPlayerSummary = {
  playerName: string;
  matchesDelta?: number;
  kills?: number;
  deaths?: number;
  wins?: number;
  losses?: number;
  damage?: number;
  headshotKills?: number;
  revives?: number;
  vehicleKills?: number;
};

type SessionGameSummary = {
  players?: SessionPlayerSummary[];
  wins?: number;
  losses?: number;
};

type SessionSummary = {
  id: string;
  start_time: string;
  end_time: string;
  games?: SessionGameSummary[];
};

const metricEnum = [...STAT_METRICS];

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function metricList(value: unknown): StatMetric[] {
  if (!Array.isArray(value)) return ['matches', 'kills', 'deaths', 'wins', 'kd', 'win_rate'];
  const metrics = value.filter((metric): metric is StatMetric =>
    typeof metric === 'string' && STAT_METRICS.includes(metric as StatMetric)
  );
  return metrics.length > 0 ? metrics : ['matches', 'kills', 'deaths', 'wins', 'kd', 'win_rate'];
}

function getOffsetMs(timezone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = values.hour === '24' ? '00' : values.hour;
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(hour),
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
}

function zonedDateToUtc(
  timezone: string,
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  const utcGuess = new Date(Date.UTC(year, monthIndex, day, hour, minute, second));
  const offset = getOffsetMs(timezone, utcGuess);
  return new Date(utcGuess.getTime() - offset);
}

function localParts(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    monthIndex: Number(values.month) - 1,
    day: Number(values.day),
    weekday: values.weekday,
  };
}

function addLocalDays(timezone: string, date: Date, days: number): Date {
  const parts = localParts(timezone, date);
  return zonedDateToUtc(timezone, parts.year, parts.monthIndex, parts.day + days);
}

function monthNameToIndex(value: string): number | null {
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const normalized = value.toLowerCase();
  const index = months.findIndex((month) => month.startsWith(normalized.slice(0, 3)));
  return index >= 0 ? index : null;
}

function parseExplicitDate(value: string, timezone: string, asEnd: boolean): Date | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return zonedDateToUtc(
      timezone,
      Number(year),
      Number(month) - 1,
      Number(day) + (asEnd ? 1 : 0)
    );
  }

  return null;
}

export function dateRangeFromText(
  startValue: unknown,
  endValue: unknown,
  timezone: string,
  now = new Date()
): DateRange {
  const startText = stringValue(startValue);
  const endText = stringValue(endValue);
  const explicitStart = startText ? parseExplicitDate(startText, timezone, false) : null;
  const explicitEnd = endText ? parseExplicitDate(endText, timezone, true) : null;

  if (explicitStart || explicitEnd) {
    return {
      start: explicitStart?.toISOString(),
      end: explicitEnd?.toISOString() || now.toISOString(),
      label: [startText || 'beginning', endText || 'now'].join(' to '),
    };
  }

  const text = (startText || '').toLowerCase();
  const parts = localParts(timezone, now);
  const todayStart = zonedDateToUtc(timezone, parts.year, parts.monthIndex, parts.day);

  if (!text || text === 'all time' || text === 'ever') {
    return { end: now.toISOString(), label: 'all time' };
  }

  if (text === 'today') {
    return { start: todayStart.toISOString(), end: now.toISOString(), label: 'today' };
  }

  if (text === 'yesterday') {
    const start = addLocalDays(timezone, todayStart, -1);
    return { start: start.toISOString(), end: todayStart.toISOString(), label: 'yesterday' };
  }

  const lastDays = text.match(/^last\s+(\d+)\s+days?$/);
  if (lastDays) {
    const days = Math.max(1, Math.min(Number(lastDays[1]), 365));
    return {
      start: addLocalDays(timezone, todayStart, -days + 1).toISOString(),
      end: now.toISOString(),
      label: `last ${days} days`,
    };
  }

  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const weekStart = addLocalDays(timezone, todayStart, -Math.max(weekdayIndex, 0));
  if (text === 'this week') {
    return { start: weekStart.toISOString(), end: now.toISOString(), label: 'this week' };
  }

  if (text === 'last week') {
    const start = addLocalDays(timezone, weekStart, -7);
    return { start: start.toISOString(), end: weekStart.toISOString(), label: 'last week' };
  }

  const thisMonthStart = zonedDateToUtc(timezone, parts.year, parts.monthIndex, 1);
  if (text === 'this month') {
    return { start: thisMonthStart.toISOString(), end: now.toISOString(), label: 'this month' };
  }

  if (text === 'last month') {
    const start = zonedDateToUtc(timezone, parts.year, parts.monthIndex - 1, 1);
    return { start: start.toISOString(), end: thisMonthStart.toISOString(), label: 'last month' };
  }

  const monthMatch = text.match(/^([a-z]+)(?:\s+(\d{4}))?$/);
  const monthIndex = monthMatch ? monthNameToIndex(monthMatch[1]) : null;
  if (monthIndex !== null) {
    const year = monthMatch?.[2] ? Number(monthMatch[2]) : parts.year;
    const start = zonedDateToUtc(timezone, year, monthIndex, 1);
    const end = zonedDateToUtc(timezone, year, monthIndex + 1, 1);
    return { start: start.toISOString(), end: end.toISOString(), label: `${monthMatch?.[1]} ${year}` };
  }

  return { end: now.toISOString(), label: startText || 'all time' };
}

async function roster(): Promise<PlayerRef[]> {
  return (await getTrackedPlayers()).map((player) => ({
    name: player.name,
    displayName: player.displayName,
  }));
}

async function resolvePlayer(value: unknown): Promise<PlayerRef | ToolResult> {
  const query = stringValue(value);
  if (!query) {
    return { unsupported: true, reason: 'No player was provided.' };
  }

  const players = await roster();
  const normalized = query.toLowerCase();
  const matches = players.filter(
    (player) =>
      player.name.toLowerCase() === normalized ||
      player.displayName.toLowerCase() === normalized
  );

  if (matches.length === 1) return matches[0];

  const partials = players.filter(
    (player) =>
      player.name.toLowerCase().includes(normalized) ||
      player.displayName.toLowerCase().includes(normalized)
  );

  if (partials.length === 1) return partials[0];
  if (partials.length > 1) {
    return {
      unsupported: true,
      reason: `Player "${query}" is ambiguous. Possible matches: ${partials
        .map((player) => player.displayName)
        .join(', ')}.`,
    };
  }

  return { unsupported: true, reason: `Player "${query}" is not in the tracked roster.` };
}

function isUnsupported(value: PlayerRef | ToolResult): value is ToolResult {
  return Boolean((value as ToolResult).unsupported);
}

async function loadGameEvents(options: {
  players?: string[];
  range?: DateRange;
  ascending?: boolean;
  limit?: number;
}): Promise<GameEventRow[]> {
  let query = supabase
    .from('game_events')
    .select('*')
    .order('event_time', { ascending: options.ascending ?? true });

  if (options.players?.length === 1) query = query.eq('player_name', options.players[0]);
  if (options.players && options.players.length > 1) query = query.in('player_name', options.players);
  if (options.range?.start) query = query.gte('event_time', options.range.start);
  if (options.range?.end) query = query.lt('event_time', options.range.end);
  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as GameEventRow[];
}

function aggregate(events: GameEventRow[]): Aggregates {
  return events.reduce(
    (sum, event) => ({
      matches: sum.matches + Number(event.matches_delta || 0),
      kills: sum.kills + Number(event.kills || 0),
      deaths: sum.deaths + Number(event.deaths || 0),
      wins: sum.wins + Number(event.wins || 0),
      losses: sum.losses + Number(event.losses || 0),
      damage: sum.damage + Number(event.damage || 0),
      headshot_kills: sum.headshot_kills + Number(event.headshot_kills || 0),
      revives: sum.revives + Number(event.revives || 0),
      vehicle_kills: sum.vehicle_kills + Number(event.vehicle_kills || 0),
      seconds: sum.seconds + Number(event.seconds_delta || 0),
    }),
    {
      matches: 0,
      kills: 0,
      deaths: 0,
      wins: 0,
      losses: 0,
      damage: 0,
      headshot_kills: 0,
      revives: 0,
      vehicle_kills: 0,
      seconds: 0,
    }
  );
}

function deriveMetric(metric: StatMetric, stats: Aggregates): number {
  switch (metric) {
    case 'kd':
      return stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills;
    case 'kills_per_match':
      return stats.matches > 0 ? stats.kills / stats.matches : 0;
    case 'deaths_per_match':
      return stats.matches > 0 ? stats.deaths / stats.matches : 0;
    case 'win_rate':
      return stats.matches > 0 ? stats.wins / stats.matches : 0;
    case 'damage_per_match':
      return stats.matches > 0 ? stats.damage / stats.matches : 0;
    case 'damage_per_minute':
      return stats.seconds > 0 ? stats.damage / (stats.seconds / 60) : 0;
    case 'kpm':
      return stats.seconds > 0 ? stats.kills / (stats.seconds / 60) : 0;
    case 'headshot_pct':
      return stats.kills > 0 ? stats.headshot_kills / stats.kills : 0;
    case 'revives_per_match':
      return stats.matches > 0 ? stats.revives / stats.matches : 0;
    case 'playtime_minutes':
      return stats.seconds / 60;
    default:
      return stats[metric];
  }
}

function statsResult(player: PlayerRef, range: DateRange, events: GameEventRow[], metrics: StatMetric[]) {
  const stats = aggregate(events);
  const result: Record<string, unknown> = {
    player: player.displayName,
    player_name: player.name,
    period: range.label,
    start: range.start,
    end: range.end,
  };

  for (const metric of metrics) result[metric] = deriveMetric(metric, stats);
  result.display = {
    mode: 'stat_card',
    title: `${player.displayName} - ${range.label}`,
    primary: Object.fromEntries(metrics.map((metric) => [metric, result[metric]])),
  };
  return result;
}

async function resolveWeapon(value: unknown): Promise<Weapon | ToolResult> {
  const query = stringValue(value);
  if (!query) return { unsupported: true, reason: 'No weapon was provided.' };
  const dataset = await loadWeaponDataset();
  const normalized = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sortedKey = normalized.split('').sort().join('');
  const exact = dataset.weapons.find(
    (weapon) => weapon.name.toLowerCase() === query.toLowerCase() ||
      weapon.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized ||
      weapon.name.toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('') === sortedKey
  );
  if (exact) return exact;

  const partials = dataset.weapons.filter((weapon) =>
    weapon.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalized)
  );

  if (partials.length === 1) return partials[0];
  if (partials.length > 1) {
    return {
      unsupported: true,
      reason: `Weapon "${query}" is ambiguous. Possible matches: ${partials.slice(0, 8).map((weapon) => weapon.name).join(', ')}.`,
    };
  }
  return { unsupported: true, reason: `Weapon "${query}" was not found in the BF6 RedSec weapon catalog.` };
}

function isWeaponUnsupported(value: Weapon | ToolResult): value is ToolResult {
  return Boolean((value as ToolResult).unsupported);
}

function resolveAttachments(attachments: AttachmentMod[], names: unknown): AttachmentMod[] {
  if (!Array.isArray(names)) return [];
  const resolved: AttachmentMod[] = [];
  for (const value of names) {
    const query = stringValue(value);
    if (!query) continue;
    const normalized = query.toLowerCase();
    const found = attachments.find((attachment) => attachment.name.toLowerCase() === normalized) ||
      attachments.find((attachment) => attachment.name.toLowerCase().includes(normalized));
    if (found) resolved.push(found);
  }
  return resolved;
}

function weaponSummary(weapon: Weapon, range: ReturnType<typeof rangeBandFromText>) {
  const avg = averageTtk(weapon, range);
  return {
    weapon: weapon.name,
    category: weapon.category,
    range: range.label,
    avg_ttk_ms: avg === null ? null : Math.round(avg),
    ttk_0m_ms: Math.round(ttkAtDistance(weapon, 0) ?? 0),
    ttk_10m_ms: Math.round(ttkAtDistance(weapon, 10) ?? 0),
    ttk_20m_ms: Math.round(ttkAtDistance(weapon, 20) ?? 0),
    ttk_40m_ms: Math.round(ttkAtDistance(weapon, 40) ?? 0),
    rpm: Math.round(weapon.rpm),
    mag_size: Math.round(weapon.magSize),
    ads_ms: Math.round(weapon.ads),
    hipfire: Math.round(weapon.hipfire),
    control: Math.round(weapon.control),
    mobility: Math.round(weapon.mobility),
    bullet_velocity: Math.round(weapon.bv),
  };
}

function weaponTtkCurve(weapon: Weapon) {
  const points = [];
  for (let distance = 0; distance <= 120; distance += 5) {
    const ttk = ttkAtDistance(weapon, distance);
    if (ttk !== null) points.push({ distance_m: distance, ttk_ms: Math.round(ttk) });
  }
  return points;
}

function resolveCategory(value: unknown): string | undefined {
  const text = stringValue(value)?.toLowerCase();
  if (!text) return undefined;
  const aliases: Record<string, string> = {
    ar: 'Assault Rifle',
    assault: 'Assault Rifle',
    assault_rifle: 'Assault Rifle',
    smg: 'SMG',
    lmg: 'LMG',
    carbine: 'Carbine',
    dmr: 'DMR',
    sniper: 'Sniper Rifle',
    sniper_rifle: 'Sniper Rifle',
    pistol: 'Pistol',
    shotgun: 'Shotgun',
  };
  const key = text.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return aliases[key] || text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function weaponGoalScore(
  weapon: Weapon,
  range: ReturnType<typeof rangeBandFromText>,
  peers: Weapon[],
  goal: string
): number {
  const base = buildScore(weapon, range, peers);
  if (!goal.includes('control') && !goal.includes('recoil')) return base;
  const controls = peers.map((peer) => peer.control);
  const min = Math.min(...controls);
  const max = Math.max(...controls);
  const controlScore = max === min ? 1 : (weapon.control - min) / (max - min);
  return base * 0.8 + controlScore * 0.2;
}

function weaponMetricValue(
  weapon: Weapon,
  metric: string,
  range: ReturnType<typeof rangeBandFromText>,
  distance?: number
): number | null {
  switch (metric) {
    case 'ttk':
      return Number.isFinite(distance) ? ttkAtDistance(weapon, distance!) : averageTtk(weapon, range);
    case 'control':
      return weapon.control;
    case 'mobility':
      return weapon.mobility;
    case 'hipfire':
      return weapon.hipfire;
    case 'ads':
      return weapon.ads;
    case 'rpm':
      return weapon.rpm;
    case 'mag_size':
      return weapon.magSize;
    case 'bullet_velocity':
      return weapon.bv;
    case 'damage':
      return weapon.damage[0]?.chest ?? weapon.damage[0]?.stomach ?? null;
    default:
      return null;
  }
}

function lowerWeaponMetricIsBetter(metric: string): boolean {
  return metric === 'ttk' || metric === 'ads' || metric === 'reload';
}

function attachmentCombos(attachments: AttachmentMod[]): AttachmentMod[][] {
  const bySlot = new Map<string, AttachmentMod[]>();
  for (const attachment of attachments) {
    const list = bySlot.get(attachment.slot) || [];
    list.push(attachment);
    bySlot.set(attachment.slot, list);
  }

  const slots = [...bySlot.entries()].map(([slot, list]) => ({
    slot,
    options: [null, ...list.slice(0, 8)] as Array<AttachmentMod | null>,
  }));
  const combos: AttachmentMod[][] = [];

  function walk(index: number, current: AttachmentMod[]) {
    if (combos.length >= 5000) return;
    if (index === slots.length) {
      combos.push(current);
      return;
    }
    for (const option of slots[index].options) {
      walk(index + 1, option ? [...current, option] : current);
    }
  }

  walk(0, []);
  return combos;
}

const statsProperties = {
  start: {
    type: 'string',
    description:
      'ISO date/time or natural range such as "April", "this week", "last week", "this month", "last month", "last 10 days", "all time".',
  },
  end: { type: 'string', description: 'Optional ISO date/time or date-only upper bound.' },
  last_n_games: {
    type: 'number',
    minimum: 1,
    maximum: 50,
    description: 'Optional recent game-event count, for questions like "last 10 games".',
  },
};

function lastNValue(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return Math.max(1, Math.min(Math.floor(numberValue(value, 0)), 50)) || undefined;
}

async function loadPlayerEvents(playerName: string, range: DateRange, lastN?: number): Promise<GameEventRow[]> {
  if (!lastN) return loadGameEvents({ players: [playerName], range });
  const events = await loadGameEvents({
    players: [playerName],
    range,
    ascending: false,
    limit: lastN,
  });
  return events.reverse();
}

function resultPeriod(range: DateRange, lastN?: number): string {
  return lastN ? `${range.label}, last ${lastN} game-events` : range.label;
}

function localDateTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export const statsTools: StatsTool[] = [
  {
    name: 'get_player_stats',
    description: 'Aggregate stats for one tracked player over a time window.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Canonical EA name or display name.' },
        ...statsProperties,
        metrics: { type: 'array', items: { type: 'string', enum: metricEnum } },
      },
      required: ['player', 'metrics'],
    },
    async handler(input, context) {
      const player = await resolvePlayer(input.player);
      if (isUnsupported(player)) return player;
      const range = dateRangeFromText(input.start, input.end, context.timezone, context.now);
      const lastN = lastNValue(input.last_n_games);
      const events = await loadPlayerEvents(player.name, range, lastN);
      return statsResult(player, { ...range, label: resultPeriod(range, lastN) }, events, metricList(input.metrics));
    },
  },
  {
    name: 'compare_players',
    description: 'Compare aggregate stats for multiple tracked players in the same time window.',
    input_schema: {
      type: 'object',
      properties: {
        players: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 20 },
        ...statsProperties,
        metrics: { type: 'array', items: { type: 'string', enum: metricEnum } },
        sort_by: { type: 'string', enum: metricEnum },
        sort_direction: { type: 'string', enum: ['asc', 'desc'] },
      },
      required: ['players', 'metrics'],
    },
    async handler(input, context) {
      const playerInputs = Array.isArray(input.players) ? input.players : [];
      const resolved = await Promise.all(playerInputs.map(resolvePlayer));
      const unsupported = resolved.find(isUnsupported);
      if (unsupported) return unsupported;
      const players = resolved as PlayerRef[];
      const range = dateRangeFromText(input.start, input.end, context.timezone, context.now);
      const metrics = metricList(input.metrics);
      const lastN = lastNValue(input.last_n_games);
      const rangeWithLabel = { ...range, label: resultPeriod(range, lastN) };
      const eventsByPlayer = await Promise.all(
        players.map(async (player) => ({
          player,
          events: await loadPlayerEvents(player.name, range, lastN),
        }))
      );
      const rows = eventsByPlayer.map(({ player, events }) =>
        statsResult(player, rangeWithLabel, events, metrics)
      );
      const sortBy = STAT_METRICS.includes(input.sort_by as StatMetric)
        ? (input.sort_by as StatMetric)
        : metrics[0];
      const sortDirection = input.sort_direction === 'asc' ? 'asc' : 'desc';
      rows.sort((a, b) => {
        const av = Number(a[sortBy] || 0);
        const bv = Number(b[sortBy] || 0);
        return sortDirection === 'asc' ? av - bv : bv - av;
      });
      const chartRows = rows
        .slice(0, 8)
        .map((row) => ({ label: String(row.player), value: Number(row[sortBy] || 0) }));
      return {
        period: rangeWithLabel.label,
        start: range.start,
        end: range.end,
        rows,
        chart: {
          type: 'bar',
          title: `${sortBy.toUpperCase()} comparison`,
          xKey: 'label',
          yKey: 'value',
          data: chartRows,
        },
        display: {
          mode: 'ranking',
          title: `${sortBy.toUpperCase()} ranking`,
          columns: ['player', sortBy, 'matches', 'wins', 'kills', 'deaths'],
          maxRows: 5,
        },
      };
    },
  },
  {
    name: 'top_matches',
    description: 'Find a player’s best or worst single game-events by kills, deaths, kd, damage, or revives.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string' },
        ...statsProperties,
        metric: { type: 'string', enum: ['kills', 'deaths', 'kd', 'damage', 'revives', 'vehicle_kills', 'headshot_kills'] },
        direction: { type: 'string', enum: ['best', 'worst'] },
        n: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['player', 'metric'],
    },
    async handler(input, context) {
      const player = await resolvePlayer(input.player);
      if (isUnsupported(player)) return player;
      const range = dateRangeFromText(input.start || 'all time', input.end, context.timezone, context.now);
      const metric = ['kills', 'deaths', 'kd', 'damage', 'revives', 'vehicle_kills', 'headshot_kills'].includes(String(input.metric)) ? String(input.metric) : 'kills';
      const direction: Direction = input.direction === 'worst' ? 'worst' : 'best';
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, 1)), 10));
      const events = await loadGameEvents({ players: [player.name], range });
      const rows = events
        .map((event) => ({
          date: event.event_time,
          local_time: localDateTime(event.event_time, context.timezone),
          matches: event.matches_delta,
          kills: event.kills,
          deaths: event.deaths,
          kd: event.deaths > 0 ? event.kills / event.deaths : event.kills,
          result: event.wins > 0 ? 'win' : 'loss',
          wins: event.wins,
          losses: event.losses,
          damage: event.damage,
          revives: event.revives,
          metric_value: metric === 'kd'
            ? event.deaths > 0 ? event.kills / event.deaths : event.kills
            : Number(event[metric as keyof GameEventRow] || 0),
        }))
        .sort((a, b) => direction === 'best' ? b.metric_value - a.metric_value : a.metric_value - b.metric_value)
        .slice(0, n);

      return {
        player: player.displayName,
        period: range.label,
        metric,
        direction,
        rows,
        display: {
          mode: n === 1 ? 'stat_card' : 'compact_table',
          title: `${player.displayName} ${direction} ${metric}`,
          primary: rows[0],
          columns: ['local_time', 'kills', 'deaths', 'kd', 'result', 'damage'],
          maxRows: n,
        },
      };
    },
  },
  {
    name: 'top_n_sessions',
    description: "Find a player's best or worst sessions by kills, deaths, wins, kd, win_rate, damage, damage_per_match, headshot_pct, or revives.",
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string' },
        metric: { type: 'string', enum: metricEnum.filter((metric) => metric !== 'kpm') },
        direction: { type: 'string', enum: ['best', 'worst'] },
        n: { type: 'number', minimum: 1, maximum: 10 },
        since: { type: 'string', description: 'Optional ISO date/time or natural range lower bound.' },
      },
      required: ['player', 'metric', 'direction', 'n'],
    },
    async handler(input, context) {
      const player = await resolvePlayer(input.player);
      if (isUnsupported(player)) return player;
      const metric = STAT_METRICS.includes(input.metric as StatMetric) ? (input.metric as StatMetric) : 'kd';
      if (['kpm', 'damage_per_minute', 'playtime_minutes'].includes(metric)) {
        return { unsupported: true, reason: 'Session summaries do not store per-session seconds played, so that session metric is not available.' };
      }
      const direction: Direction = input.direction === 'worst' ? 'worst' : 'best';
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, 3)), 10));
      const range = dateRangeFromText(input.since || 'all time', undefined, context.timezone, context.now);

      let query = supabase.from('session_summaries').select('*').order('end_time', { ascending: false });
      if (range.start) query = query.gte('end_time', range.start);
      if (range.end) query = query.lt('end_time', range.end);
      const { data, error } = await query.limit(1000);
      if (error) throw new Error(error.message);

      const rows = ((data || []) as SessionSummary[])
        .map((session) => {
          const games = Array.isArray(session.games) ? session.games : [];
          const playerGames = games
            .map((game: SessionGameSummary) => {
              const players = Array.isArray(game.players) ? game.players : [];
              return players.find((candidate: SessionPlayerSummary) => candidate.playerName === player.name);
            })
            .filter((game): game is SessionPlayerSummary => Boolean(game));
          if (playerGames.length === 0) return null;

          const stats = playerGames.reduce(
            (sum, game) => ({
              matches: sum.matches + Number(game.matchesDelta || 0),
              kills: sum.kills + Number(game.kills || 0),
              deaths: sum.deaths + Number(game.deaths || 0),
              wins: sum.wins + Number(game.wins || 0),
              losses: sum.losses + Number(game.losses || 0),
              damage: sum.damage + Number(game.damage || 0),
              headshot_kills: sum.headshot_kills + Number(game.headshotKills || 0),
              revives: sum.revives + Number(game.revives || 0),
              vehicle_kills: sum.vehicle_kills + Number(game.vehicleKills || 0),
              seconds: 0,
            }),
            aggregate([])
          );

          return {
            session_id: session.id,
            start: session.start_time,
            end: session.end_time,
            games: playerGames.length,
            matches: stats.matches,
            kills: stats.kills,
            deaths: stats.deaths,
            wins: stats.wins,
            losses: stats.losses,
            kd: deriveMetric('kd', stats),
            win_rate: deriveMetric('win_rate', stats),
            damage: stats.damage,
            damage_per_match: deriveMetric('damage_per_match', stats),
            headshot_pct: deriveMetric('headshot_pct', stats),
            revives: stats.revives,
            metric_value: deriveMetric(metric, stats),
          };
        })
        .filter(Boolean)
        .sort((a, b) =>
          direction === 'best'
            ? Number(b?.metric_value || 0) - Number(a?.metric_value || 0)
            : Number(a?.metric_value || 0) - Number(b?.metric_value || 0)
        )
        .slice(0, n);

      return { player: player.displayName, period: range.label, metric, direction, rows };
    },
  },
  {
    name: 'match_history',
    description: 'Return recent match-event breakdowns for one player with date, kills, deaths, win/loss, damage, and weapons.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string' },
        ...statsProperties,
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
      required: ['player'],
    },
    async handler(input, context) {
      const player = await resolvePlayer(input.player);
      if (isUnsupported(player)) return player;
      const range = dateRangeFromText(input.start || 'all time', input.end, context.timezone, context.now);
      const limit = Math.max(1, Math.min(Math.floor(numberValue(input.limit, 10)), 50));
      const events = await loadGameEvents({ players: [player.name], range, ascending: false, limit });
      return {
        player: player.displayName,
        period: range.label,
        rows: events.map((event) => ({
          date: event.event_time,
          local_time: localDateTime(event.event_time, context.timezone),
          matches: event.matches_delta,
          kills: event.kills,
          deaths: event.deaths,
          kd: event.deaths > 0 ? event.kills / event.deaths : event.kills,
          result: event.wins > 0 ? 'win' : 'loss',
          wins: event.wins,
          losses: event.losses,
          damage: event.damage,
        })),
        chart: {
          type: 'bar',
          title: `${player.displayName} recent kills`,
          xKey: 'label',
          yKey: 'kills',
          data: events.slice().reverse().map((event) => ({
            label: localDateTime(event.event_time, context.timezone),
            kills: event.kills,
            deaths: event.deaths,
          })),
        },
        display: {
          mode: 'compact_table',
          title: `${player.displayName} match history`,
          columns: ['local_time', 'kills', 'deaths', 'kd', 'result', 'damage'],
          maxRows: Math.min(limit, 5),
        },
      };
    },
  },
  {
    name: 'squadmate_stats',
    description: 'Stats for games where two tracked players were clustered into the same squad-game by seconds_delta proximity.',
    input_schema: {
      type: 'object',
      properties: {
        player_a: { type: 'string' },
        player_b: { type: 'string' },
        ...statsProperties,
      },
      required: ['player_a', 'player_b'],
    },
    async handler(input, context) {
      const [playerA, playerB] = await Promise.all([resolvePlayer(input.player_a), resolvePlayer(input.player_b)]);
      if (isUnsupported(playerA)) return playerA;
      if (isUnsupported(playerB)) return playerB;
      const range = dateRangeFromText(input.start || 'all time', input.end, context.timezone, context.now);
      const events = await loadGameEvents({ players: [playerA.name, playerB.name], range });
      const sessions = buildSessionsFromEvents(events);
      const sharedGames = sessions.flatMap((session) =>
        session.games.filter((game) => {
          const names = game.players.map((player) => player.playerName);
          return names.includes(playerA.name) && names.includes(playerB.name);
        })
      );

      const playerRows = [playerA, playerB].map((player) => {
        const playerEvents = sharedGames
          .map((game) => game.players.find((candidate) => candidate.playerName === player.name))
          .filter((event): event is PlayerGameDelta => Boolean(event));
        const stats = playerEvents.reduce(
          (sum, event) => ({
            matches: sum.matches + Number(event.matchesDelta || 0),
            kills: sum.kills + Number(event.kills || 0),
            deaths: sum.deaths + Number(event.deaths || 0),
            wins: sum.wins + Number(event.wins || 0),
            losses: sum.losses + Number(event.losses || 0),
            damage: sum.damage + Number(event.damage || 0),
            headshot_kills: sum.headshot_kills + Number(event.headshotKills || 0),
            revives: sum.revives + Number(event.revives || 0),
            vehicle_kills: sum.vehicle_kills + Number(event.vehicleKills || 0),
            seconds: 0,
          }),
          aggregate([])
        );
        return {
          player: player.displayName,
          matches: stats.matches,
          kills: stats.kills,
          deaths: stats.deaths,
          wins: stats.wins,
          losses: stats.losses,
          kd: deriveMetric('kd', stats),
          damage: stats.damage,
          revives: stats.revives,
        };
      });

      return {
        players: [playerA.displayName, playerB.displayName],
        period: range.label,
        shared_games: sharedGames.length,
        wins_together: sharedGames.filter((game) => game.wins > 0).length,
        losses_together: sharedGames.filter((game) => game.losses > 0).length,
        rows: playerRows,
        display: {
          mode: 'stat_card',
          title: `${playerA.displayName} + ${playerB.displayName}`,
          primary: {
            shared_games: sharedGames.length,
            wins_together: sharedGames.filter((game) => game.wins > 0).length,
            losses_together: sharedGames.filter((game) => game.losses > 0).length,
          },
          columns: ['player', 'matches', 'kills', 'deaths', 'kd', 'wins'],
          maxRows: 2,
        },
      };
    },
  },
  {
    name: 'top_weapon',
    description: 'Top weapons for one player over a time window, derived only from game_events.weapon_deltas.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string' },
        ...statsProperties,
        n: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['player'],
    },
    async handler(input, context) {
      const player = await resolvePlayer(input.player);
      if (isUnsupported(player)) return player;
      const range = dateRangeFromText(input.start || 'all time', input.end, context.timezone, context.now);
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, 5)), 10));
      const events = await loadGameEvents({ players: [player.name], range });
      const weapons = new Map<string, { weapon: string; kills: number; damage: number }>();

      for (const event of events) {
        const deltas = Array.isArray(event.weapon_deltas) ? event.weapon_deltas : [];
        for (const delta of deltas) {
          const current = weapons.get(delta.name) || { weapon: delta.name, kills: 0, damage: 0 };
          current.kills += Number(delta.kills || 0);
          current.damage += Number(delta.damage || 0);
          weapons.set(delta.name, current);
        }
      }

      return {
        player: player.displayName,
        period: range.label,
        rows: [...weapons.values()].sort((a, b) => b.kills - a.kills).slice(0, n),
        chart: {
          type: 'bar',
          title: `${player.displayName} top weapon kills`,
          xKey: 'weapon',
          yKey: 'kills',
          data: [...weapons.values()].sort((a, b) => b.kills - a.kills).slice(0, n),
        },
        display: {
          mode: 'ranking',
          title: `${player.displayName} top weapons`,
          columns: ['weapon', 'kills', 'damage'],
          maxRows: n,
        },
      };
    },
  },
  {
    name: 'compare_weapons',
    description: 'Compare BF6 RedSec weapon TTK and core stats. Use for questions like "TTK of SCW-10 vs CZA-13".',
    input_schema: {
      type: 'object',
      properties: {
        weapons: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
        range: { type: 'string', description: 'close, short, mid, long, cqc, or range band id.' },
        distance_m: { type: 'number', minimum: 0, maximum: 120 },
        attachments_by_weapon: {
          type: 'object',
          description: 'Optional map of weapon name to attachment names.',
        },
      },
      required: ['weapons'],
    },
    async handler(input) {
      const weaponInputs = Array.isArray(input.weapons) ? input.weapons : [];
      const resolved = await Promise.all(weaponInputs.map(resolveWeapon));
      const unsupported = resolved.find(isWeaponUnsupported);
      if (unsupported) return unsupported;
      const weapons = resolved as Weapon[];
      const dataset = await loadWeaponDataset();
      const range = rangeBandFromText(input.range);
      const distance = numberValue(input.distance_m, NaN);
      const attachmentMap = input.attachments_by_weapon && typeof input.attachments_by_weapon === 'object'
        ? input.attachments_by_weapon as Record<string, unknown>
        : {};

      const rows = weapons
        .map((weapon) => {
          const attachments = resolveAttachments(dataset.attachmentsByWeapon[weapon.name] || [], attachmentMap[weapon.name]);
          const calculated = applyAttachments(weapon, attachments);
          return {
            ...weaponSummary(calculated, range),
            attachments: attachments.map((attachment) => attachment.name).join(', ') || 'none',
            requested_ttk_ms: Number.isFinite(distance) ? Math.round(ttkAtDistance(calculated, distance) ?? 0) : undefined,
          };
        })
        .sort((a, b) => (a.avg_ttk_ms ?? Infinity) - (b.avg_ttk_ms ?? Infinity));
      const chartSeries = weapons.map((weapon) => {
        const attachments = resolveAttachments(dataset.attachmentsByWeapon[weapon.name] || [], attachmentMap[weapon.name]);
        const calculated = applyAttachments(weapon, attachments);
        return { name: calculated.name, data: weaponTtkCurve(calculated) };
      });

      return {
        range: range.label,
        distance_m: Number.isFinite(distance) ? distance : undefined,
        rows,
        chart: {
          type: 'line',
          title: 'TTK by distance',
          xKey: 'distance_m',
          yKey: 'ttk_ms',
          series: chartSeries,
        },
        display: {
          mode: 'compact_table',
          title: `Weapon comparison - ${range.label}`,
          columns: Number.isFinite(distance)
            ? ['weapon', 'requested_ttk_ms', 'avg_ttk_ms', 'rpm', 'mag_size', 'ads_ms', 'control']
            : ['weapon', 'avg_ttk_ms', 'ttk_10m_ms', 'ttk_20m_ms', 'rpm', 'mag_size', 'ads_ms', 'control'],
          maxRows: rows.length,
        },
      };
    },
  },
  {
    name: 'recommend_weapon_build',
    description: 'Recommend a math-only attachment build for one BF6 RedSec weapon and range goal.',
    input_schema: {
      type: 'object',
      properties: {
        weapon: { type: 'string' },
        range: { type: 'string', description: 'close, short, mid, long, cqc, or range band id.' },
        n: { type: 'number', minimum: 1, maximum: 5 },
      },
      required: ['weapon', 'range'],
    },
    async handler(input) {
      const weapon = await resolveWeapon(input.weapon);
      if (isWeaponUnsupported(weapon)) return weapon;
      const dataset = await loadWeaponDataset();
      const range = rangeBandFromText(input.range);
      const attachments = dataset.attachmentsByWeapon[weapon.name] || [];
      if (attachments.length === 0) {
        return { unsupported: true, reason: `${weapon.name} does not have cataloged attachments.` };
      }
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, 1)), 5));
      const combos = attachmentCombos(attachments);
      const calculated = combos.map((combo) => applyAttachments(weapon, combo));
      const rows = combos
        .map((combo, index) => {
          const built = calculated[index];
          const score = buildScore(built, range, calculated);
          return {
            weapon: weapon.name,
            range: range.label,
            score: Number((score * 100).toFixed(1)),
            attachments: combo.map((attachment) => `${attachment.slot}: ${attachment.name}`),
            attachment_count: combo.length,
            avg_ttk_ms: Math.round(averageTtk(built, range) ?? 0),
            ttk_10m_ms: Math.round(ttkAtDistance(built, 10) ?? 0),
            ttk_20m_ms: Math.round(ttkAtDistance(built, 20) ?? 0),
            ads_ms: Math.round(built.ads),
            hipfire: Math.round(built.hipfire),
            control: Math.round(built.control),
            mobility: Math.round(built.mobility),
            bullet_velocity: Math.round(built.bv),
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, n);
      const bestCombo = combos
        .map((combo, index) => ({ combo, built: calculated[index], score: buildScore(calculated[index], range, calculated) }))
        .sort((a, b) => b.score - a.score)[0];

      return {
        weapon: weapon.name,
        range: range.label,
        scoring: range.id === 'cqc'
          ? 'Math-only close range score: TTK, ADS, hipfire, mobility, and control.'
          : 'Math-only score: TTK, control, bullet velocity, ADS, and mobility weighted by range.',
        rows,
        chart: bestCombo ? {
          type: 'line',
          title: `${weapon.name} recommended build TTK`,
          xKey: 'distance_m',
          yKey: 'ttk_ms',
          series: [{ name: weapon.name, data: weaponTtkCurve(bestCombo.built) }],
        } : undefined,
        display: {
          mode: 'weapon_build',
          title: `${weapon.name} ${range.label} build`,
          primary: rows[0],
          columns: ['score', 'avg_ttk_ms', 'ads_ms', 'hipfire', 'control', 'mobility'],
          maxRows: n,
        },
      };
    },
  },
  {
    name: 'rank_weapons',
    description: 'Rank BF6 RedSec weapons by category, range, and math-only goal. Use for questions like "best LMG for long range with good control".',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Weapon category or alias such as LMG, SMG, AR, DMR, sniper, carbine.' },
        range: { type: 'string', description: 'close, short, mid, long, cqc, or range band id.' },
        goal: { type: 'string', description: 'Goal text such as good control, fastest ttk, balanced, recoil control.' },
        metric: { type: 'string', enum: ['score', 'ttk', 'control', 'mobility', 'hipfire', 'ads', 'rpm', 'mag_size', 'bullet_velocity', 'damage'] },
        distance_m: { type: 'number', minimum: 0, maximum: 120 },
        n: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['category', 'range'],
    },
    async handler(input) {
      const dataset = await loadWeaponDataset();
      const category = resolveCategory(input.category);
      const range = rangeBandFromText(input.range);
      const goal = stringValue(input.goal)?.toLowerCase() || 'balanced';
      const metric = stringValue(input.metric) || 'score';
      const distance = numberValue(input.distance_m, NaN);
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, 5)), 10));
      const candidates = dataset.weapons.filter((weapon) =>
        category ? weapon.category.toLowerCase() === category.toLowerCase() : true
      );

      if (candidates.length === 0) {
        return {
          unsupported: true,
          reason: `No weapons found for category "${String(input.category || '')}".`,
        };
      }

      const rows = candidates
        .map((weapon) => {
          const summary = weaponSummary(weapon, range);
          const score = Number((weaponGoalScore(weapon, range, candidates, goal) * 100).toFixed(1));
          const metricValue = metric === 'score'
            ? score
            : weaponMetricValue(weapon, metric, range, Number.isFinite(distance) ? distance : undefined);
          return {
            ...summary,
            score,
            metric,
            metric_value: metricValue === null ? null : Number(metricValue.toFixed(1)),
            requested_distance_m: Number.isFinite(distance) ? distance : undefined,
          };
        })
        .sort((a, b) => {
          if (a.metric_value === null && b.metric_value === null) return a.weapon.localeCompare(b.weapon);
          if (a.metric_value === null) return 1;
          if (b.metric_value === null) return -1;
          return lowerWeaponMetricIsBetter(metric) ? a.metric_value - b.metric_value : b.metric_value - a.metric_value;
        })
        .slice(0, n);

      return {
        category,
        range: range.label,
        goal,
        metric,
        distance_m: Number.isFinite(distance) ? distance : undefined,
        rows,
        chart: {
          type: 'bar',
          title: metric === 'score' ? `${category || 'Weapon'} score` : `${category || 'Weapon'} ${metric}`,
          xKey: 'weapon',
          yKey: metric === 'score' ? 'score' : 'metric_value',
          data: rows,
        },
        display: {
          mode: 'ranking',
          title: `${category || 'Weapon'} ranking - ${range.label}`,
          columns: metric === 'score'
            ? ['weapon', 'score', 'avg_ttk_ms', 'control', 'bullet_velocity', 'rpm', 'mag_size']
            : ['weapon', 'metric_value', 'score', 'avg_ttk_ms', 'control', 'bullet_velocity', 'mag_size'],
          maxRows: n,
        },
      };
    },
  },
  {
    name: 'weapon_details',
    description: 'Return damage profile, core stats, and attachment slots for one BF6 RedSec weapon. Use for questions about a weapon’s stats, ranges, or available attachments.',
    input_schema: {
      type: 'object',
      properties: {
        weapon: { type: 'string' },
        range: { type: 'string', description: 'Optional range context such as close, short, mid, or long.' },
      },
      required: ['weapon'],
    },
    async handler(input) {
      const weapon = await resolveWeapon(input.weapon);
      if (isWeaponUnsupported(weapon)) return weapon;
      const dataset = await loadWeaponDataset();
      const range = rangeBandFromText(input.range);
      const attachments = dataset.attachmentsByWeapon[weapon.name] || [];
      const attachmentSlots = [...new Set(attachments.map((attachment) => attachment.slot))].map((slot) => ({
        slot,
        options: attachments.filter((attachment) => attachment.slot === slot).map((attachment) => attachment.name),
      }));
      const damage_profile = weapon.damage.map((damage, index) => ({
        range_start_m: damage.dropoff,
        range_end_m: weapon.damage[index + 1]?.dropoff ?? null,
        body_damage: damage.stomach || damage.chest,
        head_damage: damage.head,
        shots_to_kill: damage.shots_to_kill,
        ttk_ms: Math.round(damage.ttk),
      }));

      return {
        ...weaponSummary(weapon, range),
        damage_profile,
        attachment_slots: attachmentSlots,
        chart: {
          type: 'line',
          title: `${weapon.name} TTK by distance`,
          xKey: 'distance_m',
          yKey: 'ttk_ms',
          series: [{ name: weapon.name, data: weaponTtkCurve(weapon) }],
        },
        display: {
          mode: 'compact_table',
          title: `${weapon.name} damage profile`,
          columns: ['range_start_m', 'range_end_m', 'body_damage', 'shots_to_kill', 'ttk_ms'],
          maxRows: 6,
        },
        rows: damage_profile,
      };
    },
  },
];

export function anthropicToolDefinitions() {
  return statsTools.map(({ name, description, input_schema }, index) => ({
    name,
    description,
    input_schema,
    cache_control: index === statsTools.length - 1 ? { type: 'ephemeral' as const } : undefined,
  }));
}

export async function dispatchStatsTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const tool = statsTools.find((candidate) => candidate.name === name);
  if (!tool) return { unsupported: true, reason: `Unknown tool "${name}".` };
  return tool.handler(input, context);
}
