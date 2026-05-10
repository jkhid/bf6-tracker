'use client';

import { FormEvent, useState } from 'react';
import { usePlayers } from '@/hooks/usePlayers';
import { usePlayerStats } from '@/hooks/usePlayerStats';
import Leaderboard from '@/components/Leaderboard';
import PlayerCard from '@/components/PlayerCard';
import HeadToHead from '@/components/HeadToHead';
import WeaponMeta from '@/components/WeaponMeta';
import Sessions from '@/components/Sessions';
import Arsenal from '@/components/Arsenal';
import AskStats from '@/components/AskStats';
import AddPlayerButton from '@/components/AddPlayerButton';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'ask', label: 'Ask', icon: '💬' },
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
  { id: 'sessions', label: 'Sessions', icon: '📊' },
  { id: 'players', label: 'Player Cards', icon: '👤' },
  { id: 'h2h', label: 'Head-to-Head', icon: '⚔️' },
  { id: 'weapons', label: 'Weapon Meta', icon: '🔫' },
  { id: 'arsenal', label: 'Weapon Stats', icon: '🎯' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function PageAskHeader({
  title,
  placeholder,
  onAsk,
}: {
  title: string;
  placeholder: string;
  onAsk: (question: string) => void;
}) {
  const [question, setQuestion] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    onAsk(trimmed);
    setQuestion('');
  }

  return (
    <section className="mb-4 rounded-xl border border-border bg-bg-card/80 px-3 py-3 shadow-[0_0_24px_rgba(245,158,11,0.05)]">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:w-44">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            {title}
          </div>
        </div>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent-gold focus:shadow-[0_0_0_3px_rgba(245,158,11,0.12)]"
        />
        <button
          type="submit"
          disabled={!question.trim()}
          className="rounded-lg border border-accent-gold/50 bg-accent-gold px-4 py-2 text-sm font-semibold text-bg-primary transition-colors hover:bg-accent-amber disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </section>
  );
}

export default function Home() {
  const { players, loading: playersLoading, error: playersError, addPlayer } = usePlayers();
  const { allPlayerData, refresh } = usePlayerStats(players);
  const [activeTab, setActiveTab] = useState<TabId>('ask');
  const [pendingAsk, setPendingAsk] = useState<{ id: number; question: string } | null>(null);

  function submitPageQuestion(question: string) {
    setPendingAsk({ id: Date.now(), question });
    setActiveTab('ask');
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-text-primary tracking-tight">
                BF6 <span className="text-accent-gold">RedSec</span> Tracker
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <AddPlayerButton onAddPlayer={addPlayer} onAdded={refresh} />
              <button
                onClick={refresh}
                className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border rounded-lg hover:border-border-accent transition-colors"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav className="border-b border-border bg-bg-primary sticky top-14 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  activeTab === tab.id
                    ? 'border-accent-gold text-accent-gold'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-accent'
                )}
              >
                <span className="mr-1.5">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {playersError && (
          <div className="mb-4 rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
            {playersError}
          </div>
        )}

        {playersLoading && (
          <div className="mb-4 text-sm text-text-muted">Loading tracked players...</div>
        )}

        {activeTab === 'ask' && <AskStats pendingAsk={pendingAsk} />}

        {activeTab === 'leaderboard' && (
          <>
            <PageAskHeader
              title="Ask Stats"
              placeholder="Ask about leaderboard K/D, win rate, recent matches..."
              onAsk={submitPageQuestion}
            />
            <Leaderboard playerData={allPlayerData} />
          </>
        )}

        {activeTab === 'sessions' && <Sessions />}

        {activeTab === 'players' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {allPlayerData.map((pd) => (
              <PlayerCard key={`${pd.player.name}_${pd.player.platform}`} data={pd} />
            ))}
          </div>
        )}

        {activeTab === 'h2h' && <HeadToHead playerData={allPlayerData} />}

        {activeTab === 'weapons' && <WeaponMeta playerData={allPlayerData} />}

        {activeTab === 'arsenal' && (
          <>
            <PageAskHeader
              title="Ask Weapons"
              placeholder="Ask about TTK, builds, recoil, weapon rankings..."
              onAsk={submitPageQuestion}
            />
            <Arsenal />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 text-center text-xs text-text-muted">
        BF6 RedSec Tracker — Stats via gametools.network
      </footer>
    </div>
  );
}
