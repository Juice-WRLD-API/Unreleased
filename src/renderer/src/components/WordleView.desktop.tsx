import {
  ChevronLeft, Search, X, Check, Music2, BarChart3, Share2, RefreshCw,
  AlertCircle, Loader2, Volume2, SlidersHorizontal, RotateCcw, Type, Delete,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import { smallCoverUrl, CATEGORY_LABELS } from '../lib/juicewrldApi'
import { eraFullName } from '../lib/eras'
import { matchedAlias, POOL_LABELS, puzzleNumber } from '../lib/heardle'
import type { PoolId, Stats } from '../lib/heardle'
import { MIN_TRIES, MAX_TRIES, MIN_OPTIONS, DEFAULT_SETTINGS, clampTries, loadStats } from '../lib/wordle'
import type { WordleMode, WordleSettings, LetterState } from '../lib/wordle'
import { GameSwitcher, GameBackdrop, Field, Segmented, numberInput } from './gameShell'
import { formatCountdown, lastUsedBucket } from '../lib/heardleViewShared'
import { tileTone, Row, useWordleSettingsForm, statsSummary } from '../lib/wordleViewShared'
import { useWordleGame, useWordlePhysicalKeyboard, MODES, KEY_ROWS } from '../hooks/useWordleGame'

// ─── Board ────────────────────────────────────────────────────────────────────

/** The keyboard: how a guess is typed, and the tracker for what's already been
 *  ruled out. Both jobs on one control - the board only ever shows the letters
 *  that have been played, and tracking twenty-six of them in your head across a
 *  title three times longer than a Wordle word is the whole difficulty.
 *
 *  Present on desktop too, not just as a touch fallback: it's where the colours
 *  live, and a physical keyboard drives the same actions (see the window
 *  listener in the view). */
function Keyboard({ hints, onLetter, onEnter, onBackspace, disabled }: {
  hints: Map<string, LetterState>
  onLetter: (letter: string) => void
  onEnter: () => void
  onBackspace: () => void
  disabled: boolean
}): JSX.Element {
  const base = 'h-10 rounded-md border flex items-center justify-center text-xs font-bold transition-colors disabled:opacity-40'
  return (
    <div className="space-y-1.5">
      {KEY_ROWS.map((row, i) => (
        <div key={row} className="flex gap-1 justify-center">
          {i === KEY_ROWS.length - 1 && (
            <button
              onClick={onEnter}
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled}
              className={`${base} flex-[1.6] border-accent/40 bg-accent/10 text-text-primary hover:bg-accent/20 text-[10px] uppercase tracking-wider`}
            >
              Enter
            </button>
          )}
          {row.split('').map((letter) => {
            const state = hints.get(letter)
            return (
              <button
                key={letter}
                onClick={() => onLetter(letter)}
                // Don't take focus: a focused letter key turns the next
                // physical Enter into another press of that letter instead of
                // a submit.
                onMouseDown={(e) => e.preventDefault()}
                disabled={disabled}
                className={`${base} flex-1 min-w-0 ${
                  state ? tileTone(state) : 'border-[var(--border)] bg-[var(--surface-overlay)]/60 text-text-primary hover:border-accent/40'
                }`}
              >
                {letter}
              </button>
            )
          })}
          {i === KEY_ROWS.length - 1 && (
            <button
              onClick={onBackspace}
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled}
              title="Delete"
              className={`${base} flex-[1.6] border-[var(--border)] bg-[var(--surface-overlay)]/60 text-text-primary hover:border-accent/40`}
            >
              <Delete size={15} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Settings panel ───────────────────────────────────────────────────────────

/** Game rules for Unlimited. Daily ignores all of them (see settingsForMode) -
 *  same rule as Heardle's panel, and said out loud for the same reason. */
function SettingsPanel({ settings, onChange, eras, mode, onClose }: {
  settings: WordleSettings
  onChange: (s: WordleSettings) => void
  eras: { era: string; count: number }[]
  mode: WordleMode
  onClose: () => void
}): JSX.Element {
  const { set, toggleEra, toggleCategory } = useWordleSettingsForm(settings, onChange)

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <SlidersHorizontal size={16} className="text-accent" />
          <h2 className="text-text-primary font-bold">Game settings</h2>
          <button
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
            title="Reset to defaults"
            className="ml-auto p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <RotateCcw size={14} />
          </button>
          <button onClick={onClose} className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-text-muted mb-3">
          These apply to <span className="text-text-secondary font-semibold">Unlimited</span> only. The Daily
          title always runs the standard rules - everyone plays the same round, and a six-guess round and a
          ten-guess round aren&apos;t the same result.
        </p>
        {mode !== 'unlimited' && (
          <p className="text-xs text-accent bg-accent/10 border border-accent/25 rounded-lg px-3 py-2 mb-4">
            You&apos;re playing Daily right now - nothing here changes that round. Switch to Unlimited to
            play by these.
          </p>
        )}

        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-1">Difficulty</h3>
        <Field label="Guesses" hint={`${MIN_TRIES}–${MAX_TRIES} titles per round`}>
          <input
            type="number"
            min={MIN_TRIES}
            max={MAX_TRIES}
            value={settings.tries}
            onChange={(e) => set('tries', clampTries(Number(e.target.value)))}
            className={numberInput}
          />
        </Field>
        <Field label="Era hint" hint="Flag wrong guesses from the answer's era">
          <Segmented
            options={[{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]}
            value={settings.eraHint ? 'on' : 'off'}
            onChange={(v) => set('eraHint', v === 'on')}
          />
        </Field>

        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mt-4 mb-1">Title pool</h3>
        <div className="py-3 border-b border-[var(--border)]">
          <div className="text-sm text-text-primary font-medium mb-2">Catalogues</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(POOL_LABELS) as PoolId[]).map((c) => (
              <button
                key={c}
                onClick={() => toggleCategory(c)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  settings.categories.includes(c)
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-[var(--border)] text-text-muted hover:text-text-primary'
                }`}
              >
                {POOL_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="py-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-sm text-text-primary font-medium">Eras</div>
            <span className="text-xs text-text-muted">
              {settings.eras.length === 0 ? 'All' : `${settings.eras.length} selected`}
            </span>
            {settings.eras.length > 0 && (
              <button onClick={() => set('eras', [])} className="ml-auto text-xs text-accent hover:underline">
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {eras.map(({ era, count }) => (
              <button
                key={era}
                onClick={() => toggleEra(era)}
                title={eraFullName(era) ?? era}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  settings.eras.includes(era)
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-[var(--border)] text-text-muted hover:text-text-primary'
                }`}
              >
                {era} <span className="opacity-60">{count}</span>
              </button>
            ))}
            {eras.length === 0 && <span className="text-xs text-text-muted">Loading…</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Reads straight from storage on open rather than mirroring the round's
 *  state - only Daily is ever recorded, so there's a single set to show. */
function StatsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const stats: Stats = loadStats()
  const { max, winRate } = statsSummary(stats)
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={16} className="text-accent" />
          <h2 className="text-text-primary font-bold">Statistics</h2>
          <button onClick={onClose} className="ml-auto p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-text-muted mb-4">Daily rounds only - Unlimited isn&apos;t counted.</p>
        <div className="grid grid-cols-4 gap-2 mb-5 text-center">
          {[
            { label: 'Played', value: stats.played },
            { label: 'Win %', value: winRate },
            { label: 'Streak', value: stats.currentStreak },
            { label: 'Best', value: stats.maxStreak },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-text-primary text-xl font-bold">{s.value}</div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {stats.distribution.slice(0, Math.max(DEFAULT_SETTINGS.tries, lastUsedBucket(stats))).map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-3 text-xs text-text-muted">{i + 1}</span>
              <div className="flex-1 h-5 rounded bg-[var(--surface-overlay)] overflow-hidden">
                <div
                  className="h-full bg-accent/70 flex items-center justify-end px-1.5"
                  style={{ width: `${Math.max(6, (n / max) * 100)}%` }}
                >
                  <span className="text-[10px] font-bold text-white">{n}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function WordleView(): JSX.Element {
  const setActiveView = useStore((s) => s.setActiveView)
  const {
    mode, setMode, settings, setSettings, poolLoading, poolError,
    answer, guesses, status,
    query, setQuery, highlighted, setHighlighted, dropdownOpen, setDropdownOpen,
    draft, notice, shake,
    showStats, setShowStats, showSettings, setShowSettings, countdown, copied, playError,
    day, isDaily, rules, tries, categories, finished,
    availableEras, entries, length, rows, hints, optionCount,
    suggestions, alreadyGuessed, submitGuess, typeLetter, backspace, submitDraft, handleKeyDown,
    playFullSong, share, newRound,
  } = useWordleGame()

  useWordlePhysicalKeyboard({ answer, finished, showSettings, showStats, submitDraft, backspace, typeLetter })

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      <GameBackdrop />

      {/* Corner controls - the hero owns the middle, so navigation and the
          panels sit out of its way. z-20 clears the scroll container; no-drag
          keeps Electron's title strip from swallowing the clicks (see
          HeardleView, which has the same corners for the same reasons). */}
      <div
        className="absolute top-4 left-4 z-20"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setActiveView('wrld')}
          title="Back"
          className="p-2.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors"
        >
          <ChevronLeft size={22} />
        </button>
      </div>
      <div
        className="absolute top-4 right-4 z-20 flex items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setShowSettings(true)}
          title="Game settings"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <SlidersHorizontal size={20} />
        </button>
        <button
          onClick={() => setShowStats(true)}
          title="Statistics"
          className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)]/60 text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <BarChart3 size={20} />
        </button>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 sm:px-6 py-10">
        <div className="mx-auto w-full max-w-xl">
          <GameSwitcher current="wordle" />

          {/* Hero */}
          <div className="text-center mb-6">
            <h1 className="text-text-primary text-4xl sm:text-5xl font-black tracking-tight inline-flex items-start gap-1">
              Juice WRLD Wordle
              <span className="text-accent text-sm font-mono font-bold mt-1">999</span>
            </h1>
            <p className="mt-2 text-[11px] font-mono lowercase tracking-[0.18em] text-text-muted">
              guess the song title, letter by letter
            </p>
          </div>

          {/* Mode tabs */}
          <div className="flex items-center justify-center gap-6 mb-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.hint}
                className={`pb-1.5 text-xs font-bold uppercase tracking-[0.2em] border-b-2 transition-colors ${
                  mode === m.id
                    ? 'text-text-primary border-accent'
                    : 'text-text-muted border-transparent hover:text-text-secondary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <p className="text-center text-[10px] font-mono tracking-wider text-text-muted mb-3">
            {isDaily && `#${puzzleNumber(day)} · `}
            {MODES.find((m) => m.id === mode)?.hint.toLowerCase()}
            {length > 0 && ` · ${length} letters · ${tries} guesses`}
            {mode === 'unlimited' && rules.eras.length > 0 && ` · ${rules.eras.join(', ')}`}
          </p>

          {/* Reroll - practice rounds aren't scored, so being stuck with a
              title you have no chance on is just a dead end. */}
          <div className="flex justify-center mb-6">
            {mode === 'unlimited' ? (
              <button
                onClick={newRound}
                disabled={entries.length === 0}
                title="Skip this title and draw another"
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--border)] hover:border-accent/40 text-text-muted hover:text-text-primary text-[10px] font-bold uppercase tracking-[0.18em] transition-colors disabled:opacity-40"
              >
                <RefreshCw size={12} /> Reroll
              </button>
            ) : (
              <div className="h-[30px]" aria-hidden />
            )}
          </div>

          {poolLoading ? (
            <div className="flex flex-col items-center gap-3 py-24 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
              <p className="text-sm">
                Loading the {categories.map((c) => POOL_LABELS[c].toLowerCase()).join(' + ')} catalogue…
              </p>
            </div>
          ) : poolError ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <AlertCircle size={22} className="text-red-400" />
              <p className="text-sm text-text-secondary">Couldn&apos;t load the catalogue - {poolError}</p>
            </div>
          ) : !answer ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-sm text-text-muted">
                {rules.eras.length > 0
                  ? 'No titles match the eras you picked.'
                  : `No title in this pool has ${MIN_OPTIONS} others its length to play against.`}
              </p>
              {rules.eras.length > 0 && (
                <button
                  onClick={() => setSettings((s) => ({ ...s, eras: [] }))}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Clear era filter
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Board */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)]/60 p-4 sm:p-5 space-y-4">
                <div className="space-y-1">
                  {Array.from({ length: tries }, (_, i) => {
                    const row = rows[i]
                    const active = !row && i === rows.length && status === 'playing'
                    const tiles = (
                      <Row
                        length={length}
                        letters={row?.key ?? (active ? draft : undefined)}
                        states={row?.states}
                        active={active}
                      />
                    )
                    // A rejected row shakes. The wrapper's key carries the
                    // shake counter so a second rejection remounts it and
                    // replays the animation instead of sitting still.
                    return active && notice
                      ? <div key={`${i}-${shake}`} className="animate-wordle-shake">{tiles}</div>
                      : <div key={i}>{tiles}</div>
                  })}
                </div>

                {notice && !finished && (
                  <p className="text-center text-xs text-red-400">{notice}</p>
                )}

                {!finished && (
                  <>
                    <Keyboard
                      hints={hints}
                      onLetter={typeLetter}
                      onEnter={submitDraft}
                      onBackspace={backspace}
                      disabled={finished}
                    />

                    {/* Second way in: the catalogue is long and some titles are
                        easier named than spelled. Picking one here submits it
                        exactly as typing it out would. */}
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                      <input
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true) }}
                        onFocus={() => setDropdownOpen(true)}
                        onKeyDown={handleKeyDown}
                        placeholder={`or find a ${length}-letter title by name…`}
                        className="w-full h-11 pl-9 pr-3 rounded-xl bg-[var(--surface-overlay)]/50 border border-[var(--border)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                      />
                      {dropdownOpen && suggestions.length > 0 && (
                        <div className="absolute bottom-full mb-1 left-0 right-0 max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-xl z-20">
                          {suggestions.map((s, i) => {
                            const alias = matchedAlias(s, query)
                            return (
                              <button
                                key={s.id}
                                onMouseEnter={() => setHighlighted(i)}
                                onClick={() => submitGuess(s)}
                                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                                  i === highlighted ? 'bg-accent/15' : 'hover:bg-surface-overlay'
                                } ${alreadyGuessed(s) ? 'opacity-40' : ''}`}
                              >
                                <span className="min-w-0">
                                  <span className="block text-sm text-text-primary truncate">{s.name}</span>
                                  {/* Why this row is here when the name doesn't
                                      match what was typed. */}
                                  {alias && (
                                    <span className="block text-[10px] text-text-muted truncate">aka {alias}</span>
                                  )}
                                </span>
                                {s.era && <span className="ml-auto shrink-0 text-[10px] text-text-muted uppercase tracking-wider">{s.era}</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                  </>
                )}
              </div>

              {/* The board carries the letters; this is the part you actually
                  read back - which titles have already been spent. */}
              {guesses.length > 0 && (
                <div className="space-y-1.5 mt-4">
                  {guesses.map((guess, i) => {
                    const correct = status === 'won' && i === guesses.length - 1
                    const sameEra = !!guess.era && guess.era === answer.song.era && rules.eraHint
                    return (
                      <div
                        key={i}
                        className={`h-10 rounded-lg border flex items-center gap-2 px-3 ${
                          correct
                            ? 'border-accent/50 bg-accent/15 text-text-primary'
                            : sameEra
                              ? 'border-amber-500/40 bg-amber-500/10 text-text-primary'
                              : 'border-[var(--border)] bg-[var(--surface-raised)] text-text-primary'
                        }`}
                      >
                        {correct
                          ? <Check size={14} className="shrink-0 text-accent" />
                          : <X size={14} className="shrink-0 text-red-400" />}
                        <span className="text-sm truncate">{guess.label}</span>
                        {!correct && sameEra && (
                          <span className="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                            Same era
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {finished && (
                <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
                  <div className="flex gap-4">
                    {/* Art stays hidden until the round is over - era covers are
                        shared, so showing one early would narrow the field. */}
                    <div className="w-20 h-20 sm:w-24 sm:h-24 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface-overlay)] overflow-hidden flex items-center justify-center">
                      {answer.song.imageUrl
                        ? <img src={smallCoverUrl(answer.song.imageUrl)} alt="" className="w-full h-full object-cover" />
                        : <Music2 size={28} className="text-text-muted" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[10px] font-bold uppercase tracking-[0.2em] mb-1 ${status === 'won' ? 'text-accent' : 'text-red-400'}`}>
                        {status === 'won'
                          ? `Got it in ${guesses.length} ${guesses.length === 1 ? 'guess' : 'guesses'}`
                          : 'Out of guesses'}
                      </p>
                      <h2 className="text-text-primary text-lg font-bold leading-snug">{answer.song.name}</h2>
                      <p className="text-sm text-text-secondary mt-0.5">
                        {[answer.song.era, CATEGORY_LABELS[answer.song.category] ?? answer.song.category,
                          answer.song.length].filter(Boolean).join(' · ')}
                      </p>
                      {/* The tiles carry the stripped title; the heading is the
                          catalogue's full name. Say so when they differ, or a
                          win on "Titanic" reading back as "Titanic (v2)" looks
                          like the game graded something else. */}
                      {/[([{]/.test(answer.song.name) && (
                        <p className="text-xs text-text-muted mt-1.5">
                          Tiles spell <span className="font-mono">{answer.key}</span> - anything in brackets
                          is left off the board.
                        </p>
                      )}
                    </div>
                  </div>
                  {playError && (
                    <p className="text-xs text-red-400 mt-3">Couldn&apos;t load that song. Check your connection.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <button
                      onClick={playFullSong}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-accent text-white hover:opacity-90 transition-opacity"
                    >
                      <Volume2 size={15} /> Play full song
                    </button>
                    {isDaily ? (
                      <button
                        onClick={share}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Share2 size={15} /> {copied ? 'Copied!' : 'Share'}
                      </button>
                    ) : (
                      <button
                        onClick={newRound}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border border-[var(--border)] text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <RefreshCw size={15} /> Next title
                      </button>
                    )}
                    {isDaily && (
                      <span className="ml-auto text-xs text-text-muted tabular-nums">
                        Next title in {formatCountdown(countdown)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!finished && (
                <p className="text-center text-[10px] font-mono tracking-wider text-text-muted mt-4 flex items-center justify-center gap-1.5">
                  <Type size={11} />
                  {tries - guesses.length} {tries - guesses.length === 1 ? 'guess' : 'guesses'} left ·
                  {' '}type it out or search by name ·
                  {' '}{optionCount} titles are {length} letters long
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          eras={availableEras}
          mode={mode}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
