import { supabase } from './supabase';
import { getTrackedPlayers } from './player-store';
import { buildSessionsFromEvents, GameEventRow, PlayerGameDelta } from './session-events';
import {
  applyAttachments,
  AttachmentMod,
  averageTtk,
  buildScore,
  RANGE_BANDS,
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
  requestedMatches?: number;
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

function uniqueMetrics(metrics: StatMetric[]): StatMetric[] {
  return [...new Set(metrics)];
}

function metricsWithDependencies(metrics: StatMetric[]): StatMetric[] {
  const expanded: StatMetric[] = [];
  for (const metric of metrics) {
    expanded.push(metric);
    switch (metric) {
      case 'kd':
        expanded.push('kills', 'deaths', 'matches');
        break;
      case 'win_rate':
        expanded.push('wins', 'losses', 'matches');
        break;
      case 'kills_per_match':
        expanded.push('kills', 'matches');
        break;
      case 'deaths_per_match':
        expanded.push('deaths', 'matches');
        break;
      case 'damage_per_match':
        expanded.push('damage', 'matches');
        break;
      case 'damage_per_minute':
        expanded.push('damage', 'playtime_minutes');
        break;
      case 'kpm':
        expanded.push('kills', 'playtime_minutes');
        break;
      case 'headshot_pct':
        expanded.push('headshot_kills', 'kills');
        break;
      case 'revives_per_match':
        expanded.push('revives', 'matches');
        break;
      default:
        break;
    }
  }
  return uniqueMetrics(expanded);
}

function compareDisplayColumns(metrics: StatMetric[], sortBy: StatMetric): string[] {
  const requested = uniqueMetrics([sortBy, ...metrics]);
  const columns: Array<'player' | StatMetric> = ['player'];

  for (const metric of requested) columns.push(metric);

  const dependencyColumns = metricsWithDependencies(requested).filter(
    (metric) => !requested.includes(metric)
  );
  for (const metric of dependencyColumns) columns.push(metric);

  if (!columns.includes('matches')) columns.push('matches');
  const base = [...new Set(columns)];
  return base.map((column) => column === 'matches' ? 'included_matches' : column);
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
  const seen = new Set<string>();
  const players: PlayerRef[] = [];
  for (const player of await getTrackedPlayers()) {
    const key = player.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    players.push({
      name: player.name,
      displayName: player.displayName,
    });
  }
  return players;
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
  if (range.requestedMatches) {
    result.requested_matches = range.requestedMatches;
    result.actual_matches = stats.matches;
    result.included_matches = stats.matches;
    if (stats.matches !== range.requestedMatches) {
      result.precision_note =
        'Recent-match windows use complete stored event rows, so the computed match total can exceed the requested count when a row contains multiple matches.';
    }
  }

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

function attachmentAffectsTtk(attachment: AttachmentMod): boolean {
  return Boolean(
    attachment.damageProfile?.length ||
    attachment.rangeMod ||
    attachment.mods.rpm_mod ||
    attachment.mods.hsmultiplier_mod
  );
}

function attachmentPracticalValue(attachment: AttachmentMod, goal: string): number {
  const mods = attachment.mods;
  let value = 0;
  value += Math.max(0, mods.mag_size_mod || 0) * 3.5;
  value += Math.max(0, -(mods.reload_mod || 0)) * 20;
  value += Math.max(0, -(mods.ads_mod || 0)) * (goal.includes('close') || goal.includes('cqc') ? 1.2 : 0.7);
  value += Math.max(0, mods.control_mod || 0) * (goal.includes('control') || goal.includes('long') ? 2.4 : 1.3);
  value += Math.max(0, mods.bv_mod || 0) * (goal.includes('long') ? 0.12 : 0.04);
  value += Math.max(0, mods.hipfire_mod || 0) * (goal.includes('close') || goal.includes('hip') || goal.includes('cqc') ? 0.8 : 0.2);
  value += Math.max(0, mods.mobility_mod || 0) * 0.8;
  if (attachmentAffectsTtk(attachment)) value += 30;
  return value;
}

function practicalAttachmentPool(weapon: Weapon, attachments: AttachmentMod[], range: typeof RANGE_BANDS[number], goal: string): AttachmentMod[] {
  const explicitUtility = /flashlight|laser|right accessory|scope|optic|sight/i.test(goal);
  const filtered = attachments.filter((attachment) => {
    if (!explicitUtility && attachment.slot === 'Right Accessory') return false;
    if (!explicitUtility && attachment.slot === 'Scope') return false;
    return attachmentPracticalValue(attachment, `${goal} ${range.id}`) > 0;
  });

  const bySlot = new Map<string, AttachmentMod[]>();
  for (const attachment of filtered) {
    const list = bySlot.get(attachment.slot) || [];
    list.push(attachment);
    bySlot.set(attachment.slot, list);
  }

  const practical: AttachmentMod[] = [];
  for (const [slot, list] of bySlot) {
    if (slot === 'Magazine' && weapon.magSize < 20) {
      const largest = [...list].sort((a, b) => (b.mods.mag_size_mod || 0) - (a.mods.mag_size_mod || 0))[0];
      if (largest) practical.push(largest);
      continue;
    }
    practical.push(
      ...list
        .sort((a, b) => attachmentPracticalValue(b, `${goal} ${range.id}`) - attachmentPracticalValue(a, `${goal} ${range.id}`))
        .slice(0, 5)
    );
  }

  return practical;
}

function shotsToKillAtDistance(weapon: Weapon, distance: number): number {
  if (!weapon.damage.length) return 0;
  let chosen = weapon.damage[0];
  for (const damage of weapon.damage) {
    if (damage.dropoff <= distance) chosen = damage;
    else break;
  }
  return chosen.shots_to_kill || 0;
}

function practicalBuildScore(
  baseWeapon: Weapon,
  builtWeapon: Weapon,
  range: typeof RANGE_BANDS[number],
  peers: Weapon[],
  attachments: AttachmentMod[],
  goal: string
): number {
  const base = buildScore(builtWeapon, range, peers);
  const ttk = averageTtk(builtWeapon, range) ?? Infinity;
  const baseTtk = averageTtk(baseWeapon, range) ?? Infinity;
  const ttkImprovement = Number.isFinite(ttk) && Number.isFinite(baseTtk) ? Math.max(0, baseTtk - ttk) / Math.max(baseTtk, 1) : 0;
  const representativeDistance = range.id === 'cqc' ? 5 : range.id === 'short' ? 20 : range.id === 'mid' ? 60 : 100;
  const shots = shotsToKillAtDistance(builtWeapon, representativeDistance);
  const killsPerMag = shots > 0 ? builtWeapon.magSize / shots : 0;
  const magFloor = baseWeapon.magSize < 20 ? 25 : 20;
  const magScore = Math.min(builtWeapon.magSize / magFloor, 1);
  const hasLowValueOnly = attachments.some((attachment) => attachment.slot === 'Right Accessory' || attachment.slot === 'Scope');
  const utilityPenalty = hasLowValueOnly && !/flashlight|scope|optic|sight/i.test(goal) ? 0.08 : 0;
  const ttkWeight = goal.includes('ttk') ? 0.3 : 0.18;
  const practicalWeight = baseWeapon.magSize < 20 ? 0.26 : 0.12;

  return Math.min(
    1,
    Math.max(0, base * (1 - practicalWeight) + magScore * practicalWeight + ttkImprovement * ttkWeight + Math.min(killsPerMag / 3, 1) * 0.08 - utilityPenalty)
  );
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
    description:
      'Optional recent match count, for questions like "last 10 games". Because stored event rows can contain multiple matches, handlers include enough recent rows to cover at least this many matches.',
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
    limit: Math.max(50, lastN * 8),
  });

  const selected: GameEventRow[] = [];
  let matches = 0;
  for (const event of events) {
    selected.push(event);
    matches += Math.max(0, Number(event.matches_delta || 0));
    if (matches >= lastN) break;
  }

  return selected.reverse();
}

function resultPeriod(range: DateRange, lastN?: number): string {
  return lastN ? `${range.label}, most recent at least ${lastN} matches` : range.label;
}

type TrendGranularity = 'day' | 'week' | 'month';

function trendGranularity(value: unknown): TrendGranularity {
  const text = stringValue(value)?.toLowerCase();
  if (text === 'week' || text === 'weekly') return 'week';
  if (text === 'month' || text === 'monthly') return 'month';
  return 'day';
}

function localDateKey(timezone: string, date: Date): string {
  const parts = localParts(timezone, date);
  return `${parts.year}-${String(parts.monthIndex + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function bucketLabel(timezone: string, iso: string, granularity: TrendGranularity): string {
  const date = new Date(iso);
  const parts = localParts(timezone, date);
  if (granularity === 'month') {
    return `${parts.year}-${String(parts.monthIndex + 1).padStart(2, '0')}`;
  }
  if (granularity === 'week') {
    const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    const start = addLocalDays(
      timezone,
      zonedDateToUtc(timezone, parts.year, parts.monthIndex, parts.day),
      -Math.max(weekdayIndex, 0)
    );
    return localDateKey(timezone, start);
  }
  return localDateKey(timezone, date);
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
      return statsResult(
        player,
        { ...range, label: resultPeriod(range, lastN), requestedMatches: lastN },
        events,
        metricList(input.metrics)
      );
    },
  },
  {
    name: 'compare_players',
    description: 'Compare aggregate stats for multiple tracked players in the same time window.',
    input_schema: {
      type: 'object',
      properties: {
        players: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 20,
          description:
            'Specific players to compare. For everyone/all players queries, omit this and set all_players true.',
        },
        all_players: {
          type: 'boolean',
          description: 'Use the full tracked roster. Set this for "everyone", "all players", or roster-wide rankings.',
        },
        ...statsProperties,
        metrics: { type: 'array', items: { type: 'string', enum: metricEnum } },
        sort_by: { type: 'string', enum: metricEnum },
        sort_direction: { type: 'string', enum: ['asc', 'desc'] },
      },
      required: ['metrics'],
    },
    async handler(input, context) {
      const playerInputs = Array.isArray(input.players) ? input.players : [];
      const wantsAllPlayers =
        input.all_players === true ||
        playerInputs.length === 0 ||
        playerInputs.some((player) => {
          const value = stringValue(player)?.toLowerCase();
          return value === 'all' || value === 'everyone' || value === 'all players';
        });
      const players = wantsAllPlayers ? await roster() : null;
      let resolvedPlayers: PlayerRef[];
      if (players) {
        resolvedPlayers = players;
      } else {
        const resolved = await Promise.all(playerInputs.map(resolvePlayer));
        const unsupported = resolved.find(isUnsupported);
        if (unsupported) return unsupported;
        resolvedPlayers = resolved as PlayerRef[];
      }
      const range = dateRangeFromText(input.start, input.end, context.timezone, context.now);
      const requestedMetrics = metricList(input.metrics);
      const lastN = lastNValue(input.last_n_games);
      const rangeWithLabel = {
        ...range,
        label: resultPeriod(range, lastN),
        requestedMatches: lastN,
      };
      const eventsByPlayer = await Promise.all(
        resolvedPlayers.map(async (player) => ({
          player,
          events: await loadPlayerEvents(player.name, range, lastN),
        }))
      );
      const sortBy = STAT_METRICS.includes(input.sort_by as StatMetric)
        ? (input.sort_by as StatMetric)
        : requestedMetrics[0];
      const displayColumns = compareDisplayColumns(requestedMetrics, sortBy);
      const metricColumns = displayColumns.map((column) => column === 'included_matches' ? 'matches' : column);
      const metrics = metricsWithDependencies(metricColumns.filter((column): column is StatMetric =>
        column !== 'player' && STAT_METRICS.includes(column as StatMetric)
      ));
      const rows = eventsByPlayer.map(({ player, events }) =>
        statsResult(player, rangeWithLabel, events, metrics)
      ).filter((row) => !lastN || Number(row.actual_matches || 0) >= lastN);
      const sortDirection = input.sort_direction === 'asc' ? 'asc' : 'desc';
      rows.sort((a, b) => {
        const av = Number(a[sortBy] || 0);
        const bv = Number(b[sortBy] || 0);
        return sortDirection === 'asc' ? av - bv : bv - av;
      });
      const chartRows = rows
        .map((row) => ({ label: String(row.player), value: Number(row[sortBy] || 0) }));
      return {
        period: rangeWithLabel.label,
        start: range.start,
        end: range.end,
        roster_count: wantsAllPlayers ? resolvedPlayers.length : undefined,
        excluded_for_insufficient_matches: lastN
          ? resolvedPlayers.length - rows.length
          : undefined,
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
          columns: displayColumns,
          maxRows: rows.length,
        },
      };
    },
  },
  {
    name: 'stat_trend',
    description: 'Bucket one player or the full roster by day, week, or month for trend questions and charts.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Optional player. Omit when all_players is true.' },
        all_players: {
          type: 'boolean',
          description: 'Use the full tracked roster as one combined group.',
        },
        ...statsProperties,
        metric: { type: 'string', enum: metricEnum },
        granularity: { type: 'string', enum: ['day', 'week', 'month', 'daily', 'weekly', 'monthly'] },
      },
      required: ['metric'],
    },
    async handler(input, context) {
      const range = dateRangeFromText(input.start || 'last 30 days', input.end, context.timezone, context.now);
      const granularity = trendGranularity(input.granularity);
      const metric = STAT_METRICS.includes(input.metric as StatMetric) ? (input.metric as StatMetric) : 'kd';
      const allPlayers = input.all_players === true || !input.player;
      const selectedPlayers = allPlayers ? await roster() : [await resolvePlayer(input.player)];
      const unsupported = selectedPlayers.find(isUnsupported);
      if (unsupported) return unsupported;
      const players = selectedPlayers as PlayerRef[];
      const events = await loadGameEvents({ players: players.map((player) => player.name), range });
      const buckets = new Map<string, GameEventRow[]>();

      for (const event of events) {
        const key = bucketLabel(context.timezone, event.event_time, granularity);
        const list = buckets.get(key) || [];
        list.push(event);
        buckets.set(key, list);
      }

      const rows = [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bucket, bucketEvents]) => {
          const stats = aggregate(bucketEvents);
          return {
            bucket,
            period: bucket,
            matches: stats.matches,
            kills: stats.kills,
            deaths: stats.deaths,
            wins: stats.wins,
            losses: stats.losses,
            kd: deriveMetric('kd', stats),
            win_rate: deriveMetric('win_rate', stats),
            damage: stats.damage,
            damage_per_match: deriveMetric('damage_per_match', stats),
            kpm: deriveMetric('kpm', stats),
            metric_value: deriveMetric(metric, stats),
          };
        });

      return {
        player: allPlayers ? 'All players' : players[0].displayName,
        period: range.label,
        metric,
        granularity,
        rows,
        chart: {
          type: 'bar',
          title: `${metric.toUpperCase()} by ${granularity}`,
          xKey: 'bucket',
          yKey: 'metric_value',
          data: rows,
        },
        display: {
          mode: 'compact_table',
          title: `${metric.toUpperCase()} trend`,
          columns: ['bucket', 'metric_value', 'matches', 'kills', 'deaths', 'wins'],
          maxRows: rows.length,
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
    name: 'compare_squadmates',
    description: 'Rank which tracked teammates a player performs best or worst with in shared clustered games.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string' },
        ...statsProperties,
        metric: { type: 'string', enum: ['wins', 'win_rate', 'matches', 'kills', 'kd', 'damage', 'revives'] },
        direction: { type: 'string', enum: ['best', 'worst'] },
        n: { type: 'number', minimum: 1, maximum: 20 },
      },
      required: ['player'],
    },
    async handler(input, context) {
      const player = await resolvePlayer(input.player);
      if (isUnsupported(player)) return player;
      const players = (await roster()).filter((candidate) => candidate.name !== player.name);
      const range = dateRangeFromText(input.start || 'all time', input.end, context.timezone, context.now);
      const metric = ['wins', 'win_rate', 'matches', 'kills', 'kd', 'damage', 'revives'].includes(String(input.metric))
        ? String(input.metric)
        : 'win_rate';
      const direction: Direction = input.direction === 'worst' ? 'worst' : 'best';
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, players.length)), 20));
      const events = await loadGameEvents({ players: [player.name, ...players.map((candidate) => candidate.name)], range });
      const sessions = buildSessionsFromEvents(events);

      const rows = players.map((teammate) => {
        const sharedGames = sessions.flatMap((session) =>
          session.games.filter((game) => {
            const names = game.players.map((entry) => entry.playerName);
            return names.includes(player.name) && names.includes(teammate.name);
          })
        );
        const playerEvents = sharedGames
          .map((game) => game.players.find((entry) => entry.playerName === player.name))
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
        const row = {
          teammate: teammate.displayName,
          shared_games: sharedGames.length,
          matches: stats.matches,
          wins: stats.wins,
          losses: stats.losses,
          win_rate: deriveMetric('win_rate', stats),
          kills: stats.kills,
          deaths: stats.deaths,
          kd: deriveMetric('kd', stats),
          damage: stats.damage,
          revives: stats.revives,
        };
        return { ...row, metric_value: Number(row[metric as keyof typeof row] || 0) };
      })
        .filter((row) => row.shared_games > 0)
        .sort((a, b) => direction === 'best' ? b.metric_value - a.metric_value : a.metric_value - b.metric_value)
        .slice(0, n);

      return {
        player: player.displayName,
        period: range.label,
        metric,
        direction,
        rows,
        chart: {
          type: 'bar',
          title: `${player.displayName} squadmate ${metric}`,
          xKey: 'teammate',
          yKey: 'metric_value',
          data: rows,
        },
        display: {
          mode: 'ranking',
          title: `${player.displayName} squadmate ranking`,
          columns: ['teammate', 'metric_value', 'shared_games', 'wins', 'win_rate', 'kd'],
          maxRows: rows.length,
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
    name: 'weapon_usage',
    description: 'Rank player weapon usage from game_events.weapon_deltas. Use for questions like "who has the most SCW-10 kills" or a player’s weapon damage ranking.',
    input_schema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Optional player for one-player weapon rankings.' },
        all_players: { type: 'boolean', description: 'Rank all tracked players for one weapon.' },
        weapon: { type: 'string', description: 'Optional specific weapon name.' },
        category: { type: 'string', description: 'Optional weapon category such as LMG, SMG, AR, DMR, sniper, carbine.' },
        ...statsProperties,
        metric: { type: 'string', enum: ['kills', 'damage'] },
        n: { type: 'number', minimum: 1, maximum: 20 },
      },
    },
    async handler(input, context) {
      const metric = input.metric === 'damage' ? 'damage' : 'kills';
      const range = dateRangeFromText(input.start || 'all time', input.end, context.timezone, context.now);
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, 10)), 20));
      const dataset = await loadWeaponDataset();
      const category = resolveCategory(input.category);
      const weapon = input.weapon ? await resolveWeapon(input.weapon) : null;
      if (weapon && isWeaponUnsupported(weapon)) return weapon;
      const allowedWeaponNames = new Set(
        dataset.weapons
          .filter((candidate) => category ? candidate.category.toLowerCase() === category.toLowerCase() : true)
          .map((candidate) => candidate.name)
      );
      const targetWeaponName = weapon && !isWeaponUnsupported(weapon) ? weapon.name : undefined;

      if (category && allowedWeaponNames.size === 0) {
        return { unsupported: true, reason: `No weapons found for category "${String(input.category || '')}".` };
      }

      const wantsAllPlayers = input.all_players === true || !input.player;
      const selectedPlayers = wantsAllPlayers ? await roster() : [await resolvePlayer(input.player)];
      const unsupported = selectedPlayers.find(isUnsupported);
      if (unsupported) return unsupported;
      const players = selectedPlayers as PlayerRef[];
      const playerByName = new Map(players.map((player) => [player.name, player]));
      const events = await loadGameEvents({ players: players.map((player) => player.name), range });

      if (targetWeaponName && wantsAllPlayers) {
        const rowsByPlayer = new Map<string, { player: string; weapon: string; kills: number; damage: number }>();
        for (const event of events) {
          const deltas = Array.isArray(event.weapon_deltas) ? event.weapon_deltas : [];
          for (const delta of deltas) {
            if (delta.name !== targetWeaponName) continue;
            const playerRef = playerByName.get(event.player_name);
            if (!playerRef) continue;
            const current = rowsByPlayer.get(event.player_name) || {
              player: playerRef.displayName,
              weapon: targetWeaponName,
              kills: 0,
              damage: 0,
            };
            current.kills += Number(delta.kills || 0);
            current.damage += Number(delta.damage || 0);
            rowsByPlayer.set(event.player_name, current);
          }
        }
        const rows = [...rowsByPlayer.values()].sort((a, b) => b[metric] - a[metric]).slice(0, n);
        return {
          weapon: targetWeaponName,
          period: range.label,
          metric,
          rows,
          chart: {
            type: 'bar',
            title: `${targetWeaponName} ${metric} by player`,
            xKey: 'player',
            yKey: metric,
            data: rows,
          },
          display: {
            mode: 'ranking',
            title: `${targetWeaponName} ${metric}`,
            columns: ['player', 'weapon', 'kills', 'damage'],
            maxRows: rows.length,
          },
        };
      }

      const weapons = new Map<string, { weapon: string; category?: string; kills: number; damage: number }>();
      const categoryByWeapon = new Map(dataset.weapons.map((candidate) => [candidate.name, candidate.category]));
      for (const event of events) {
        const deltas = Array.isArray(event.weapon_deltas) ? event.weapon_deltas : [];
        for (const delta of deltas) {
          if (targetWeaponName && delta.name !== targetWeaponName) continue;
          if (category && !allowedWeaponNames.has(delta.name)) continue;
          const current = weapons.get(delta.name) || {
            weapon: delta.name,
            category: categoryByWeapon.get(delta.name),
            kills: 0,
            damage: 0,
          };
          current.kills += Number(delta.kills || 0);
          current.damage += Number(delta.damage || 0);
          weapons.set(delta.name, current);
        }
      }
      const rows = [...weapons.values()].sort((a, b) => b[metric] - a[metric]).slice(0, n);

      return {
        player: wantsAllPlayers ? 'All players' : players[0].displayName,
        period: range.label,
        weapon: targetWeaponName,
        category,
        metric,
        rows,
        chart: {
          type: 'bar',
          title: `${metric.toUpperCase()} by weapon`,
          xKey: 'weapon',
          yKey: metric,
          data: rows,
        },
        display: {
          mode: 'ranking',
          title: 'Weapon usage',
          columns: ['weapon', 'category', 'kills', 'damage'],
          maxRows: rows.length,
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
        goal: { type: 'string', description: 'Build goal such as fastest TTK, close-range aggressive, low recoil, larger magazine, or balanced.' },
        n: { type: 'number', minimum: 1, maximum: 5 },
      },
      required: ['weapon', 'range'],
    },
    async handler(input) {
      const weapon = await resolveWeapon(input.weapon);
      if (isWeaponUnsupported(weapon)) return weapon;
      const dataset = await loadWeaponDataset();
      const range = rangeBandFromText(input.range);
      const goal = `${stringValue(input.goal) || ''} ${stringValue(input.range) || ''}`.toLowerCase();
      const attachments = practicalAttachmentPool(weapon, dataset.attachmentsByWeapon[weapon.name] || [], range, goal);
      if (attachments.length === 0) {
        return { unsupported: true, reason: `${weapon.name} does not have cataloged attachments.` };
      }
      const n = Math.max(1, Math.min(Math.floor(numberValue(input.n, 1)), 5));
      const combos = attachmentCombos(attachments);
      const calculated = combos.map((combo) => applyAttachments(weapon, combo));
      const baseAvgTtk = averageTtk(weapon, range);
      const rows = combos
        .map((combo, index) => {
          const built = calculated[index];
          const score = practicalBuildScore(weapon, built, range, calculated, combo, goal);
          const avgTtk = averageTtk(built, range);
          const ttkDelta = baseAvgTtk !== null && avgTtk !== null ? avgTtk - baseAvgTtk : null;
          return {
            weapon: weapon.name,
            range: range.label,
            score: Number((score * 100).toFixed(1)),
            attachments: combo.map((attachment) => `${attachment.slot}: ${attachment.name}`),
            attachment_count: combo.length,
            base_avg_ttk_ms: baseAvgTtk === null ? null : Math.round(baseAvgTtk),
            avg_ttk_ms: Math.round(avgTtk ?? 0),
            ttk_delta_ms: ttkDelta === null ? null : Math.round(ttkDelta),
            ttk_10m_ms: Math.round(ttkAtDistance(built, 10) ?? 0),
            ttk_20m_ms: Math.round(ttkAtDistance(built, 20) ?? 0),
            ads_ms: Math.round(built.ads),
            mag_size: Math.round(built.magSize),
            hipfire: Math.round(built.hipfire),
            control: Math.round(built.control),
            mobility: Math.round(built.mobility),
            bullet_velocity: Math.round(built.bv),
            ttk_improving_attachments: combo.filter(attachmentAffectsTtk).map((attachment) => attachment.name),
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, n);
      const bestCombo = combos
        .map((combo, index) => ({
          combo,
          built: calculated[index],
          score: practicalBuildScore(weapon, calculated[index], range, calculated, combo, goal),
        }))
        .sort((a, b) => b.score - a.score)[0];
      const bestTtkDelta = rows[0]?.ttk_delta_ms;

      return {
        weapon: weapon.name,
        range: range.label,
        goal: stringValue(input.goal) || stringValue(input.range) || 'balanced',
        scoring: range.id === 'cqc'
          ? 'Practical close-range score: TTK first, then magazine size, ADS, hipfire, mobility, and control. Utility/right-accessory picks are ignored unless explicitly requested.'
          : 'Practical score: TTK, control, bullet velocity, magazine size, ADS, and mobility weighted by range. Utility/right-accessory picks are ignored unless explicitly requested.',
        practical_notes: [
          weapon.magSize < 20
            ? `${weapon.name} has a ${weapon.magSize}-round stock magazine, so practical builds strongly prefer the largest magazine option.`
            : null,
          bestTtkDelta !== null && bestTtkDelta !== undefined && bestTtkDelta >= 0
            ? 'The recommended build does not reduce mathematical TTK; it improves practical handling/sustain around the same TTK.'
            : null,
        ].filter(Boolean),
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
          columns: ['score', 'avg_ttk_ms', 'ttk_delta_ms', 'mag_size', 'ads_ms', 'hipfire', 'control', 'mobility'],
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
