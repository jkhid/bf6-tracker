export function dicebearUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/fun-emoji/svg?seed=${encodeURIComponent(seed)}`;
}

// gametools changed accepted platform values: pc→ea, ps5→psn, xboxseries→xbox
export function toGametoolsPlatform(platform: string): string {
  if (platform === 'pc') return 'ea';
  if (platform === 'ps5') return 'psn';
  if (platform === 'xboxseries') return 'xbox';
  return platform;
}
