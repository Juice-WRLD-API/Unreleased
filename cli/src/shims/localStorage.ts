import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_DIR } from '../config'

// The site's game modules (wordle.ts, heardle.ts) keep settings, saved rounds,
// streaks and their song pools in localStorage. Here that's one JSON file,
// ~/.unreleased/storage.json, so the CLI keeps its own progress between runs
// (separate from the browser's, the way two browsers are separate).
const FILE = join(HOME_DIR, 'storage.json')

class FileStorage {
  private data: Record<string, string> | null = null

  private load(): Record<string, string> {
    if (this.data) return this.data
    try { this.data = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string> } catch { this.data = {} }
    return this.data
  }

  private save(): void {
    try {
      mkdirSync(HOME_DIR, { recursive: true })
      writeFileSync(FILE, JSON.stringify(this.data))
    } catch { /* still usable for this session */ }
  }

  get length(): number { return Object.keys(this.load()).length }
  key(i: number): string | null { return Object.keys(this.load())[i] ?? null }
  getItem(key: string): string | null { return this.load()[key] ?? null }
  setItem(key: string, value: string): void { this.load()[key] = String(value); this.save() }
  removeItem(key: string): void { delete this.load()[key]; this.save() }
  clear(): void { this.data = {}; this.save() }
}

export function installLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', { value: new FileStorage(), configurable: true, writable: true })
}
