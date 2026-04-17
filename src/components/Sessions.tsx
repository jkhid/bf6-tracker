'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { dicebearUrl } from '@/lib/avatar';

interface WeaponDelta {
  name: string;
  kills: number;
  damage: number;
  image: string;
  altImage: string;
}

interface PlayerGameDelta {
  playerName: string;
  displayName: string;
  avatar: string;
  matchesDelta: number;
  kills: number;
  deaths: number;
  kd: number;
  wins: number;
  losses: number;
  headshotKills: number;
  revives: number;
  vehicleKills: number;
  damage: number;
  weaponDeltas: WeaponDelta[];
}

interface Game {
  time: string;
  players: PlayerGameDelta[];
  matchCount: number;
  kills: number;
  deaths: number;
  damage: number;
  wins: number;
  losses: number;
}

interface Session {
  id: string;
  startTime: string;
  endTime: string;
  games: Game[];
  players: string[];
  totalMatches: number;
  totalKills: number;
  totalDeaths: number;
  totalWins: number;
  totalLosses: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDamage(dmg: number): string {
  if (dmg >= 1000) return `${(dmg / 1000).toFixed(1)}k`;
  return dmg.toString();
}

function WeaponChip({ weapon }: { weapon: WeaponDelta }) {
  const imgSrc = weapon.altImage || weapon.image;
  return (
    <div className="flex items-center gap-1.5 bg-bg-primary/60 px-2 py-1 rounded border border-border/30">
      {imgSrc ? (
        <Image
          src={imgSrc}
          alt={weapon.name}
          width={28}
          height={14}
          className="object-contain opacity-80"
          unoptimized
        />
      ) : (
        <span className="text-[9px] text-text-muted w-7 text-center">?</span>
      )}
      <span className="text-[10px] text-text-muted">{weapon.name}</span>
      <span className="text-[10px] font-bold text-text-primary">+{weapon.kills}</span>
    </div>
  );
}

function PlayerGameCard({ player, rank }: { player: PlayerGameDelta; rank: number }) {
  const isTopKd = rank === 0;

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/40 bg-gradient-to-br from-bg-card to-bg-primary">
      {/* Accent stripe */}
      <div className={`absolute top-0 left-0 w-1 h-full ${isTopKd ? 'bg-accent-gold' : 'bg-border-accent'}`} />

      <div className="pl-4 pr-3 py-3">
        {/* Player header */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Image
              src={dicebearUrl(player.playerName)}
              alt={player.displayName}
              width={28}
              height={28}
              className="rounded-full ring-1 ring-border/50 bg-bg-primary"
              unoptimized
            />
            <span className="text-sm font-semibold text-text-primary">{player.displayName}</span>
            {player.matchesDelta > 1 && (
              <span className="text-[9px] text-text-muted bg-bg-primary/60 px-1.5 py-0.5 rounded">
                {player.matchesDelta} matches
              </span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-5 gap-1.5 mb-2.5">
          <div className="text-center">
            <div className="text-[9px] text-text-muted uppercase tracking-wider">K/D</div>
            <div className="text-sm font-bold text-accent-gold tabular-nums">
              {player.kd.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-text-muted uppercase tracking-wider">Kills</div>
            <div className="text-sm font-bold text-text-primary tabular-nums">{player.kills}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-text-muted uppercase tracking-wider">Deaths</div>
            <div className="text-sm font-bold text-text-primary tabular-nums">{player.deaths}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-text-muted uppercase tracking-wider">DMG</div>
            <div className="text-sm font-bold text-info tabular-nums">
              {player.damage > 0 ? formatDamage(player.damage) : '-'}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[9px] text-text-muted uppercase tracking-wider">Revives</div>
            <div className="text-sm font-bold text-text-primary tabular-nums">
              {player.revives > 0 ? player.revives : '-'}
            </div>
          </div>
        </div>

        {/* Secondary stats */}
        {(player.headshotKills > 0 || player.vehicleKills > 0) && (
          <div className="flex gap-3 text-[10px] text-text-muted mb-2">
            {player.headshotKills > 0 && <span>HS: {player.headshotKills}</span>}
            {player.vehicleKills > 0 && <span>Vehicles: {player.vehicleKills}</span>}
          </div>
        )}

        {/* Weapon deltas */}
        {player.weaponDeltas.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {player.weaponDeltas.map((w) => (
              <WeaponChip key={w.name} weapon={w} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GameCard({ game, gameNumber, totalGames }: { game: Game; gameNumber: number; totalGames: number }) {
  const isWin = game.wins > 0;
  const groupKd = game.deaths > 0 ? (game.kills / game.deaths).toFixed(2) : game.kills.toString();

  // Sort players by kills descending for ranking
  const rankedPlayers = [...game.players].sort((a, b) => b.kd - a.kd);

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-colors ${
        isWin
          ? 'border-positive/20 bg-positive/[0.02]'
          : 'border-negative/20 bg-negative/[0.02]'
      }`}
    >
      {/* Game header bar */}
      <div
        className={`px-4 py-2.5 flex items-center justify-between ${
          isWin
            ? 'bg-positive/[0.06] border-b border-positive/10'
            : 'bg-negative/[0.06] border-b border-negative/10'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-mono">#{gameNumber}</span>
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                isWin
                  ? 'bg-positive/15 text-positive'
                  : 'bg-negative/15 text-negative'
              }`}
            >
              {isWin ? 'WIN' : 'LOSS'}
            </span>
          </div>
          <span className="text-xs text-text-muted">{formatTime(game.time)}</span>
          {game.matchCount > 1 && (
            <span className="text-[10px] text-text-muted bg-bg-primary/40 px-1.5 py-0.5 rounded">
              {game.matchCount} matches
            </span>
          )}
        </div>

        <div className="flex items-center gap-5 text-xs">
          <div className="text-center">
            <span className="text-text-muted">Kills </span>
            <span className="font-bold text-text-primary tabular-nums">{game.kills}</span>
          </div>
          {game.damage > 0 && (
            <div className="text-center">
              <span className="text-text-muted">DMG </span>
              <span className="font-bold text-info tabular-nums">{formatDamage(game.damage)}</span>
            </div>
          )}
          <div className="text-center">
            <span className="text-text-muted">K/D </span>
            <span className="font-bold text-accent-gold tabular-nums">{groupKd}</span>
          </div>
        </div>
      </div>

      {/* Player cards */}
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {rankedPlayers.map((p, i) => (
          <PlayerGameCard key={p.playerName} player={p} rank={i} />
        ))}
      </div>
    </div>
  );
}

function ForceTrackingButton() {
  const [active, setActive] = useState(false);
  const [activeUntil, setActiveUntil] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/force-tracking')
      .then((r) => r.json())
      .then((data) => {
        setActive(data.active);
        setActiveUntil(data.activeUntil);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggle() {
    setLoading(true);
    const res = await fetch('/api/force-tracking', {
      method: active ? 'DELETE' : 'POST',
    });
    const data = await res.json();
    setActive(data.active);
    setActiveUntil(data.activeUntil);
    setLoading(false);
  }

  if (loading) return null;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={toggle}
        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
          active
            ? 'bg-positive/10 text-positive border-positive/30 hover:bg-positive/20'
            : 'text-text-secondary border-border hover:text-text-primary hover:border-border-accent'
        }`}
      >
        {active ? 'Tracking Active' : 'Force Tracking'}
      </button>
      {active && activeUntil && (
        <span className="text-[10px] text-text-muted">
          until {new Date(activeUntil).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/sessions?limit=30');
        if (!res.ok) throw new Error('Failed to load sessions');
        const data = await res.json();
        setSessions(data.sessions || []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-28 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-negative">{error}</div>;
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <p className="text-lg mb-2">No sessions recorded yet</p>
        <p className="text-sm">
          Sessions will appear here once the tracker starts capturing snapshots and someone plays a
          match.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <ForceTrackingButton />
      </div>
      {sessions.map((session) => {
        const expanded = expandedId === session.id;
        const groupKd =
          session.totalDeaths > 0
            ? (session.totalKills / session.totalDeaths).toFixed(2)
            : session.totalKills.toString();

        return (
          <div
            key={session.id}
            className="bg-bg-card border border-border rounded-lg overflow-hidden hover:border-border-accent transition-colors"
          >
            {/* Session Header */}
            <button
              onClick={() => setExpandedId(expanded ? null : session.id)}
              className="w-full px-5 py-4 flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-4">
                <div>
                  <div className="text-sm font-bold text-text-primary">
                    {formatDate(session.endTime)}
                  </div>
                  <div className="text-xs text-text-muted">{timeAgo(session.endTime)}</div>
                </div>

                {/* Player names */}
                <div className="hidden sm:flex gap-1 text-xs text-text-secondary">
                  {session.players.join(', ')}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-xs text-text-muted">Games</div>
                  <div className="text-sm font-bold text-text-primary tabular-nums">
                    {session.totalMatches}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">Record</div>
                  <div className="text-sm font-bold tabular-nums">
                    <span className="text-positive">{session.totalWins}W</span>
                    <span className="text-text-muted"> / </span>
                    <span className="text-negative">{session.totalLosses}L</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">K/D</div>
                  <div className="text-sm font-bold text-accent-gold tabular-nums">{groupKd}</div>
                </div>
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-text-muted">Kills</div>
                  <div className="text-sm font-bold text-text-primary tabular-nums">
                    {session.totalKills}
                  </div>
                </div>
                <svg
                  className={`w-4 h-4 text-text-muted transition-transform ${
                    expanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </button>

            {/* Expanded: per-game breakdown */}
            {expanded && (
              <div className="border-t border-border px-4 py-4 space-y-3">
                {/* Session summary bar */}
                <div className="flex items-center justify-between text-xs text-text-muted px-1">
                  <span>
                    {formatTime(session.startTime)} — {formatTime(session.endTime)}
                  </span>
                  <span>{session.games.length} game{session.games.length !== 1 ? 's' : ''} detected</span>
                </div>

                {/* Individual games */}
                <div className="space-y-3">
                  {session.games.map((game, i) => (
                    <GameCard
                      key={game.time}
                      game={game}
                      gameNumber={i + 1}
                      totalGames={session.games.length}
                    />
                  ))}
                </div>

                {/* Session totals */}
                {session.games.length > 1 && (
                  <div className="border-t border-border/50 pt-3 px-1">
                    <div className="text-[10px] text-text-muted uppercase tracking-widest mb-2">
                      Session Totals
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="text-text-secondary">
                        Kills: <strong className="text-text-primary">{session.totalKills}</strong>
                      </span>
                      <span className="text-text-secondary">
                        Deaths:{' '}
                        <strong className="text-text-primary">{session.totalDeaths}</strong>
                      </span>
                      <span className="text-text-secondary">
                        K/D: <strong className="text-accent-gold">{groupKd}</strong>
                      </span>
                      <span className="text-text-secondary">
                        Record:{' '}
                        <strong>
                          <span className="text-positive">{session.totalWins}W</span>
                          {' / '}
                          <span className="text-negative">{session.totalLosses}L</span>
                        </strong>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
