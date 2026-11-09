const PROFILE_NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,18}[\p{L}\p{N}]$/u
const BLOCKED_TERMS = [
  'ass', 'assault', 'assassin', 'attack', 'bastard', 'beating', 'behead', 'bitch', 'bloodbath', 'bomb', 'bullshit',
  'choke', 'choking', 'cunt', 'decapitate', 'drown', 'drowning', 'execute', 'execution', 'explode', 'explosion',
  'explosive', 'fucker', 'fucking', 'fuck', 'genocide', 'gunman', 'gun', 'hitman', 'killed', 'killer', 'killing',
  'kill', 'lynch', 'massacre', 'motherfucker', 'murderer', 'murdering', 'murder', 'poison', 'rape', 'rapist',
  'shooting', 'shooter', 'shoot', 'shithead', 'shitty', 'shitting', 'shits', 'shit', 'slaughter', 'slut', 'sniper',
  'stab', 'stabbing', 'strangle', 'strangling', 'suicide', 'terrorism', 'terrorist', 'torture', 'weapon', 'whore',
  'wound',
]
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' }
const SAFE_NAME_TEXT = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[0134578@$!|]/g, (c) => LEET[c] ?? c)

export const normalizeProfileName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ')
export const profileNameKey = (value: string) => normalizeProfileName(value).toLowerCase()

export function profileNameProblem(value: string): 'format' | 'language' | null {
  const name = normalizeProfileName(value)
  if (!PROFILE_NAME_RULE.test(name)) return 'format'
  const safeText = SAFE_NAME_TEXT(name)
  for (const term of BLOCKED_TERMS) {
    const spelling = [...term].join('[^\\p{L}\\p{N}]*')
    if (new RegExp(`(?<![\\p{L}\\p{N}])${spelling}(?![\\p{L}\\p{N}])`, 'u').test(safeText)) return 'language'
  }
  return null
}
