export interface Player {
  name: string;
  displayName: string;
  platform: 'pc' | 'ps5' | 'xboxseries';
}

export interface WeaponStat {
  weaponName: string;
  type: string;
  image: string;
  altImage: string;
  kills: number;
  damage: number;
  accuracy: string;
  killsPerMinute: number;
  damagePerMinute: number;
  headshots: string;
  headshotKills: number;
  hipfireKills: number;
  multiKills: number;
  timeEquipped: string;
}

export interface VehicleStat {
  vehicleName: string;
  type: string;
  image: string;
  kills: number;
  damage: number;
  spawns: number;
  roadKills: number;
  multiKills: number;
  distanceTraveled: number;
  timeIn: string;
  destroyed: number;
  damageTo: number;
  vehiclesDestroyedWith: number;
}

export interface ClassStat {
  className: string;
  image: string;
  kills: number;
  deaths: number;
  killDeath: number;
  kpm: number;
  score: number;
  secondsPlayed: number;
}

export interface MapStat {
  mapName: string;
  image: string;
  wins: number;
  losses: number;
  matches: number;
  winPercent: string;
  secondsPlayed: number;
}

export interface GameModeStat {
  id: string;
  gamemodeName: string;
  image: string;
  altImage: string;
  kills: number;
  deaths: number;
  killDeath: number;
  wins: number;
  losses: number;
  winPercent: string;
  matches: number;
  headshots: string;
  headshotKills: number;
  kpm: number;
  dpm: number;
  vehiclesDestroyedWith: number;
  revives: number;
  repairs: number;
  spots: number;
  intelPickups: number;
  objectivesDestroyed: number;
  objectivesArmed: number;
  secondsPlayed: number;
}

export interface GadgetStat {
  gadgetName: string;
  type: string;
  image: string;
  kills: number;
  damage: number;
  uses: number;
  vehiclesDestroyedWith: number;
  kpm: number;
  dpm: number;
}

export interface DividedKills {
  confirmed: number;
  ads: number;
  hipfire: number;
  longDistance: number;
  melee: number;
  multiKills: number;
  vehicle: number;
  human: number;
  weapons: Record<string, number>;
}

export interface PlayerStats {
  userName: string;
  avatar: string;
  kills: number;
  deaths: number;
  wins: number;
  loses: number;
  killDeath: number;
  winPercent: string;
  timePlayed: string;
  accuracy: string;
  headshots: string;
  matchesPlayed: number;
  killsPerMinute: number;
  damagePerMinute: number;
  killsPerMatch: number;
  damagePerMatch: number;
  revives: number;
  repairs: number;
  vehiclesDestroyed: number;
  saviorKills: number;
  humanPrecentage: string;
  weapons: WeaponStat[];
  vehicles: VehicleStat[];
  classes: ClassStat[];
  maps: MapStat[];
  gameModes: GameModeStat[];
  gameModeGroups: GameModeStat[];
  gadgets: GadgetStat[];
  weaponGroups: Record<string, unknown>[];
  dividedKills: DividedKills;
  XP: { total: number; performance: number; accolades: number }[];
  distanceTraveled: { foot: number; passenger: number; vehicle: number };
}

export interface PlayerData {
  player: Player;
  stats: PlayerStats | null;
  error: string | null;
  loading: boolean;
}
