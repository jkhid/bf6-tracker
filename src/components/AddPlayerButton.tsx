'use client';

import { FormEvent, useState } from 'react';
import { Player } from '@/lib/types';

const PLATFORMS: { value: Player['platform']; label: string }[] = [
  { value: 'ea', label: 'EA' },
  { value: 'steam', label: 'Steam' },
  { value: 'epic', label: 'Epic' },
  { value: 'psn', label: 'PSN' },
  { value: 'xbox', label: 'Xbox' },
];

interface AddPlayerButtonProps {
  onAddPlayer: (player: Player) => Promise<unknown>;
  onAdded?: () => void;
}

export default function AddPlayerButton({ onAddPlayer, onAdded }: AddPlayerButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [platform, setPlatform] = useState<Player['platform']>('ea');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await onAddPlayer({
        name: name.trim(),
        displayName: displayName.trim(),
        platform,
      });

      setName('');
      setDisplayName('');
      setPlatform('ea');
      setOpen(false);
      onAdded?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs text-bg-primary bg-accent-gold hover:bg-accent-amber rounded-lg font-semibold transition-colors"
      >
        + Add Player
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center px-4 pt-20">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold text-text-primary">Add tracked player</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-text-muted hover:text-text-primary text-xl leading-none"
            aria-label="Close add player dialog"
          >
            x
          </button>
        </div>

        <div className="space-y-4 p-4">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
              EA / platform username
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold"
              placeholder="redFrog40"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Display name
            </span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold"
              placeholder="Nic"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
              Platform
            </span>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Player['platform'])}
              className="mt-1 w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold"
            >
              {PLATFORMS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {error && (
            <div className="rounded-lg border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-1.5 text-xs text-bg-primary bg-accent-gold hover:bg-accent-amber disabled:opacity-60 rounded-lg font-semibold transition-colors"
          >
            {submitting ? 'Adding...' : 'Add player'}
          </button>
        </div>
      </form>
    </div>
  );
}
