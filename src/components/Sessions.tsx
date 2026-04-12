'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

interface WeaponDelta {
  name: string;
  kills: number;
}

interface PlayerMatchDelta {
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
  weaponDeltas: WeaponDelta[];
}

interface Session {
  id: string;
  startTime: string;
  endTime: string;
  players: PlayerMatchDelta[];
  totalMatches: number;
  totalKills: number;
  totalDeaths: number;
  totalWins: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
        <p className="text-sm">Sessions will appear here once the tracker starts capturing snapshots.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sessions.map((session) => {
        const expanded = expandedId === session.id;
        const groupKd =
          session.totalDeaths > 0
            ? (session.totalKills / session.totalDeaths).toFixed(2)
            : session.totalKills.toString();
        const winCount = session.totalWins;
        const lossCount = session.players.reduce((s, p) => s + p.losses, 0);
        const result = `${winCount}W / ${lossCount}L`;

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

                {/* Player avatars */}
                <div className="flex -space-x-2">
                  {session.players.map((p) => (
                    <div key={p.playerName} className="relative" title={p.displayName}>
                      {p.avatar ? (
                        <Image
                          src={p.avatar}
                          alt={p.displayName}
                          width={28}
                          height={28}
                          className="rounded-full border-2 border-bg-card"
                          unoptimized
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-border border-2 border-bg-card flex items-center justify-center text-[10px] text-text-muted">
                          {p.displayName[0]}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="hidden sm:flex gap-1">
                  {session.players.map((p) => (
                    <span key={p.playerName} className="text-xs text-text-secondary">
                      {p.displayName}
                      {p !== session.players[session.players.length - 1] && ','}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-xs text-text-muted">Matches</div>
                  <div className="text-sm font-bold text-text-primary tabular-nums">
                    {session.totalMatches}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">Result</div>
                  <div className="text-sm font-bold tabular-nums">
                    <span className="text-positive">{winCount}W</span>
                    <span className="text-text-muted"> / </span>
                    <span className="text-negative">{lossCount}L</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-text-muted">Group K/D</div>
                  <div className="text-sm font-bold text-accent-gold tabular-nums">{groupKd}</div>
                </div>
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-text-muted">Kills</div>
                  <div className="text-sm font-bold text-text-primary tabular-nums">
                    {session.totalKills}
                  </div>
                </div>
                <svg
                  className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Expanded Details */}
            {expanded && (
              <div className="border-t border-border px-5 py-4 space-y-4">
                {/* Time range */}
                <div className="text-xs text-text-muted">
                  {formatTime(session.startTime)} — {formatTime(session.endTime)}
                </div>

                {/* Individual player stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {session.players.map((p) => (
                    <div
                      key={p.playerName}
                      className="bg-bg-primary rounded-lg p-4 border border-border/50"
                    >
                      <div className="flex items-center gap-2 mb-3">
                        {p.avatar ? (
                          <Image
                            src={p.avatar}
                            alt={p.displayName}
                            width={32}
                            height={32}
                            className="rounded-full"
                            unoptimized
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-border" />
                        )}
                        <div>
                          <div className="text-sm font-bold text-text-primary">{p.displayName}</div>
                          <div className="text-[10px] text-text-muted">
                            {p.matchesDelta} match{p.matchesDelta !== 1 ? 'es' : ''}
                          </div>
                        </div>
                      </div>

                      {/* Stats grid */}
                      <div className="grid grid-cols-4 gap-2 mb-3">
                        <div>
                          <div className="text-[10px] text-text-muted uppercase">K/D</div>
                          <div className="text-base font-bold text-accent-gold tabular-nums">
                            {p.kd.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-text-muted uppercase">Kills</div>
                          <div className="text-base font-bold text-text-primary tabular-nums">
                            {p.kills}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-text-muted uppercase">Deaths</div>
                          <div className="text-base font-bold text-text-primary tabular-nums">
                            {p.deaths}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-text-muted uppercase">W/L</div>
                          <div className="text-base font-bold tabular-nums">
                            <span className="text-positive">{p.wins}</span>
                            <span className="text-text-muted">/</span>
                            <span className="text-negative">{p.losses}</span>
                          </div>
                        </div>
                      </div>

                      {/* Secondary stats */}
                      <div className="flex gap-3 text-xs text-text-secondary mb-2">
                        {p.headshotKills > 0 && <span>HS: {p.headshotKills}</span>}
                        {p.revives > 0 && <span>Revives: {p.revives}</span>}
                        {p.vehicleKills > 0 && <span>Veh: {p.vehicleKills}</span>}
                      </div>

                      {/* Weapon deltas */}
                      {p.weaponDeltas.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {p.weaponDeltas.map((w) => (
                            <span
                              key={w.name}
                              className="text-[10px] bg-bg-card px-2 py-0.5 rounded text-text-secondary"
                            >
                              {w.name}: +{w.kills}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Group summary */}
                {session.players.length > 1 && (
                  <div className="border-t border-border/50 pt-3">
                    <div className="text-xs text-text-muted uppercase tracking-wider mb-2">
                      Group Totals
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="text-text-secondary">
                        Kills: <strong className="text-text-primary">{session.totalKills}</strong>
                      </span>
                      <span className="text-text-secondary">
                        Deaths: <strong className="text-text-primary">{session.totalDeaths}</strong>
                      </span>
                      <span className="text-text-secondary">
                        Group K/D:{' '}
                        <strong className="text-accent-gold">{groupKd}</strong>
                      </span>
                      <span className="text-text-secondary">
                        Record:{' '}
                        <strong>
                          <span className="text-positive">{winCount}W</span>
                          {' / '}
                          <span className="text-negative">{lossCount}L</span>
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
