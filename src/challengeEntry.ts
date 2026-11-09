import { carToJson, type CarFile } from './carFile'

export function isCurrentDailyBoard(gpId: string, today: number): boolean {
  return /^d:\d+$/.test(gpId) && Number(gpId.slice(2)) === today
}

export function entryCarForSelection(value: string, current: CarFile | null, shelf: CarFile[]): CarFile | null {
  if (value === 'current') return current
  if (!value.startsWith('shelf:')) return null
  const saved = value.slice('shelf:'.length)
  return shelf.find((c) => carToJson(c) === saved) ?? null
}
