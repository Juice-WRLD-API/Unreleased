// Field editing for Heardle's Game Settings panel - identical between the
// desktop modal and the mobile Sheet; only the wrapping JSX differs.
import { stageLadder } from '../lib/heardle'
import type { HeardleSettings, PoolId } from '../lib/heardle'

export function useHeardleSettingsPanel(
  settings: HeardleSettings,
  onChange: (s: HeardleSettings) => void,
): {
  ladder: number[]
  set: <K extends keyof HeardleSettings>(key: K, value: HeardleSettings[K]) => void
  toggleEra: (era: string) => void
  toggleCategory: (cat: PoolId) => void
} {
  const set = <K extends keyof HeardleSettings>(key: K, value: HeardleSettings[K]): void =>
    onChange({ ...settings, [key]: value })

  const ladder = stageLadder(settings)
  const toggleEra = (era: string): void =>
    set('eras', settings.eras.includes(era) ? settings.eras.filter((e) => e !== era) : [...settings.eras, era])
  const toggleCategory = (cat: PoolId): void => {
    const next = settings.categories.includes(cat)
      ? settings.categories.filter((c) => c !== cat)
      : [...settings.categories, cat]
    // Never leave nothing to draw from.
    if (next.length > 0) set('categories', next)
  }

  return { ladder, set, toggleEra, toggleCategory }
}
