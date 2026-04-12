'use client';

import { useState } from 'react';
import { usePlayers } from '@/hooks/usePlayers';
import { usePlayerStats } from '@/hooks/usePlayerStats';
import Leaderboard from '@/components/Leaderboard';
import PlayerCard from '@/components/PlayerCard';
import HeadToHead from '@/components/HeadToHead';
import WeaponMeta from '@/components/WeaponMeta';
import Sessions from '@/components/Sessions';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' },
  { id: 'sessions', label: 'Sessions', icon: '📊' },
  { id: 'players', label: 'Player Cards', icon: '👤' },
  { id: 'h2h', label: 'Head-to-Head', icon: '⚔️' },
  { id: 'weapons', label: 'Weapon Meta', icon: '🔫' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Home() {
  const { players } = usePlayers();
  const { allPlayerData, refresh } = usePlayerStats(players);
  const [activeTab, setActiveTab] = useState<TabId>('leaderboard');

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
            <button
              onClick={refresh}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border rounded-lg hover:border-border-accent transition-colors"
            >
              Refresh
            </button>
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
        {activeTab === 'leaderboard' && <Leaderboard playerData={allPlayerData} />}

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
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 text-center text-xs text-text-muted">
        BF6 RedSec Tracker — Stats via gametools.network
      </footer>
    </div>
  );
}
