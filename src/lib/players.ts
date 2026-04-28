import { Player } from './types';

/**
 * Add or remove players here.
 * - name: EA/Origin username (used for API lookups)
 * - displayName: real name or nickname shown in the UI
 * - platform: 'pc' | 'ps5' | 'xboxseries'
 */
export const PLAYERS: Player[] = [
  { name: 'redFrog40', displayName: 'Nic', platform: 'steam' },
  { name: 'magicpinoy650', displayName: 'Jamal', platform: 'ea' },
  { name: 'JmXxStealth', displayName: 'Jai', platform: 'ea' },      // username may be wrong — not found in gametools
  { name: 'STATnMELO650', displayName: 'Adi', platform: 'ea' },
  { name: 'CastingC0uch945', displayName: 'Ryan', platform: 'ea' }, // username may be wrong — not found in gametools
  { name: 'nmetzger123', displayName: 'Metz', platform: 'ea' },
  { name: 'ra1ca', displayName: 'Nathan', platform: 'steam' },
  { name: 'Coffeesquirts89', displayName: 'Poo', platform: 'ea' },
  { name: 'mrnudebanana', displayName: 'MrBanana', platform: 'ea' },

];
