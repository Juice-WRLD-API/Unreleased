import { useEffect } from 'react'
import {
  Search, X, Check, Music2, BarChart3, Share2, RefreshCw,
  AlertCircle, Loader2, Volume2, SlidersHorizontal, RotateCcw, Type, Delete,
} from 'lucide-react'
import { useStorePick } from '../store/useStore'
import { Sheet } from './mobile/Sheet'
import { smallCoverUrl, CATEGORY_LABELS } from '../lib/juicewrldApi'
import { eraFullName } from '../lib/eras'
import { matchedAlias, POOL_LABELS, puzzleNumber } from '../lib/heardle'
import type { PoolId, Stats } from '../lib/heardle'
import { MIN_TRIES, MAX_TRIES, MIN_OPTIONS, DEFAULT_SETTINGS, clampTries, loadStats } from '../lib/wordle'
import type { WordleMode, WordleSettings, LetterState } from '../lib/wordle'
import { GameSwitcher, GameBackdrop, Field, Segmented, numberInput } from './gameShell'
import { formatCountdown, lastUsedBucket } from '../lib/heardleViewShared'
import { tileTone, Row, useWordleSettingsForm, statsSummary } from '../lib/wordleViewShared'
import { useWordleGame, MODES, KEY_ROWS } from '../hooks/useWordleGame'
import { BackButton, BarButton } from './mobile/NavBar'
import { Segmented as IosSegmented } from './mobile/Segmented'

// ─── Board ────────────────────────────────────────────────────────────────────

/** The keyboard: how a guess is typed, and the tracker for what's already been
 *  ruled out. Both jobs on one control - the board only ever shows the letters
 *  that have been played, and tracking twenty-six of them in your head across a
 *  title three times longer than a Wordle word is the whole difficulty. */
function Keyboard({ hints, onLetter, onEnter, onBackspace, disabled }: {
  hints: Map<string, LetterState>
  onLetter: (letter: string) => void
  onEnter: () => void
  onBackspace: () => void
  disabled: boolean
}): JSX.Element {
  const base = 'h-11 rounded-[7px] border flex items-center justify-center text-subhead font-semibold transition-colors disabled:opacity-40'
  return (
    <div className="space-y-1.5">
      {KEY_ROWS.map((row, i) => (
        <div key={row} className="flex gap-1 justify-center">
          {i === KEY_ROWS.length - 1 && (
            <button
              onClick={onEnter}
              disabled={disabled}
              className={`${base} flex-[1.6] border-transparent bg-accent text-white active:opacity-80 !text-footnote`}
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
                disabled={disabled}
                className={`${base} flex-1 min-w-0 ${
                  state ? tileTone(state) : 'border-transparent bg-[var(--fill-strong)] text-text-primary active:bg-[var(--fill)]'
                }`}
              >
                {letter}
              </button>
            )
          })}
          {i === KEY_ROWS.length - 1 && (
            <button
              onClick={onBackspace}
              disabled={disabled}
              title="Delete"
              className={`${base} flex-[1.6] border-transparent bg-[var(--fill-strong)] text-text-primary active:bg-[var(--fill)]`}
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
    <Sheet
      onClose={onClose}
      title="Game settings"
      header={
        <div className="px-5 pt-2 flex justify-end">
          <button
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
            className="flex items-center gap-1.5 h-9 px-1 text-subhead text-accent active:opacity-60 transition-opacity"
          >
            <RotateCcw size={14} /> Reset to defaults
          </button>
        </div>
      }
    >
      <div className="px-5 pb-2">
        <p className="text-footnote text-text-secondary mb-3">
          These apply to <span className="text-text-primary font-semibold">Unlimited</span> only. The Daily
          title always runs the standard rules - everyone plays the same round, and a six-guess round and a
          ten-guess round aren't the same result.
        </p>
        {mode !== 'unlimited' && (
          <p className="text-footnote text-accent bg-accent/10 rounded-xl px-3 py-2 mb-4">
            You're playing Daily right now - nothing here changes that round. Switch to Unlimited to
            play by these.
          </p>
        )}

        <h3 className="text-footnote font-semibold text-text-secondary mb-1">Difficulty</h3>
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

        <h3 className="text-footnote font-semibold text-text-secondary mt-5 mb-1">Title pool</h3>
        <div className="py-3 border-b border-[var(--separator)]">
          <div className="text-body text-text-primary mb-2">Catalogues</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(POOL_LABELS) as PoolId[]).map((c) => (
              <button
                key={c}
                onClick={() => toggleCategory(c)}
                className={`h-8 px-3 rounded-full text-footnote font-semibold transition-colors ${
                  settings.categories.includes(c)
                    ? 'bg-accent/15 text-accent'
                    : 'bg-[var(--fill)] text-text-secondary'
                }`}
              >
                {POOL_LABELS[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="py-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-body text-text-primary">Eras</div>
            <span className="text-footnote text-text-muted">
              {settings.eras.length === 0 ? 'All' : `${settings.eras.length} selected`}
            </span>
            {settings.eras.length > 0 && (
              <button onClick={() => set('eras', [])} className="ml-auto text-subhead text-accent active:opacity-60">
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
                className={`h-8 px-3 rounded-full text-footnote font-semibold transition-colors ${
                  settings.eras.includes(era)
                    ? 'bg-accent/15 text-accent'
                    : 'bg-[var(--fill)] text-text-secondary'
                }`}
              >
                {era} <span className="opacity-60">{count}</span>
              </button>
            ))}
            {eras.length === 0 && <span className="text-footnote text-text-muted">Loading…</span>}
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/** Reads straight from storage on open rather than mirroring the round's
 *  state - only Daily is ever recorded, so there's a single set to show. */
function StatsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const stats: Stats = loadStats()
  const { max, winRate } = statsSummary(stats)
  return (
    <Sheet onClose={onClose} title="Statistics">
      <div className="px-5 pb-4">
        <p className="text-footnote text-text-secondary mb-4">Daily rounds only - Unlimited isn't counted.</p>
        <div className="grid grid-cols-4 gap-2 mb-5 text-center rounded-[20px] bg-[var(--fill)] py-3">
          {[
            { label: 'Played', value: stats.played },
            { label: 'Win %', value: winRate },
            { label: 'Streak', value: stats.currentStreak },
            { label: 'Best', value: stats.maxStreak },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-title2 text-text-primary tabular-nums">{s.value}</div>
              <div className="text-caption1 text-text-secondary">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {stats.distribution.slice(0, Math.max(DEFAULT_SETTINGS.tries, lastUsedBucket(stats))).map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-3 text-footnote text-text-secondary tabular-nums">{i + 1}</span>
              <div className="flex-1 h-6 rounded-md bg-[var(--fill)] overflow-hidden">
                <div
                  className="h-full rounded-md bg-accent flex items-center justify-end px-2"
                  style={{ width: `${Math.max(6, (n / max) * 100)}%` }}
                >
                  <span className="text-caption1 font-semibold text-white tabular-nums">{n}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  )
}

// ─── View ─────────────────────────────────────────────────────────────────────

export default function WordleView(): JSX.Element {
  const { setActiveView, setHeroBleedTop, previousView } = useStorePick(
    'setActiveView', 'setHeroBleedTop', 'previousView')

  // Lets GameBackdrop's wash paint full-bleed under the status bar instead of
  // stopping at the shell's usual inset - matches WRLD's ownsTopInset trick.
  // The corner buttons and the switcher's top clearance compensate below.
  // Always true: mobile's nav bar is bottom-only now (see BottomNav), so the
  // shell always reserves this inset itself.
  const ownsTopInset = true
  useEffect(() => {
    setHeroBleedTop(true)
    return () => setHeroBleedTop(false)
  }, [setHeroBleedTop])

  const {
    mode, setMode, settings, setSettings, poolLoading, poolError,
    answer, guesses, status,
    query, setQuery, highlighted, dropdownOpen, setDropdownOpen,
    draft, notice, shake,
    showStats, setShowStats, showSettings, setShowSettings, countdown, copied, playError,
    isDaily, rules, tries, categories, finished,
    availableEras, entries, day, length, rows, hints, optionCount,
    suggestions, alreadyGuessed, submitGuess, typeLetter, backspace, submitDraft, handleKeyDown,
    playFullSong, share, newRound,
  } = useWordleGame()

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex-1 flex flex-col h-full overflow-hidden bg-[var(--surface)]">
      <GameBackdrop />

      {/* Corner controls - the hero owns the middle, so navigation and the
          panels sit out of its way. z-20: the scroll container fills the whole
          view and comes later in the DOM, so at equal z it took every click in
          these corners and left the buttons visible but dead. */}
      <div
        className="absolute left-2 z-20"
        style={{ top: ownsTopInset ? 'calc(var(--top-inset) + 0.5rem)' : '0.5rem' }}
      >
        {/* See HeardleView.mobile.tsx's back button - same reasoning: Home,
            not WRLD, is where mobile actually enters this game from now. */}
        <BackButton onClick={() => setActiveView(previousView ?? 'home')} />
      </div>
      <div
        className="absolute right-2 z-20 flex items-center gap-2"
        style={{ top: ownsTopInset ? 'calc(var(--top-inset) + 0.5rem)' : '0.5rem' }}
      >
        <BarButton label="Game settings" onClick={() => setShowSettings(true)}>
          <SlidersHorizontal size={19} />
        </BarButton>
        <BarButton label="Statistics" onClick={() => setShowStats(true)}>
          <BarChart3 size={19} />
        </BarButton>
      </div>

      {/* z-10: the backdrop layers above are absolutely positioned, so content
          has to be positioned too or they paint over it. */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 pt-2 pb-10">
        <div className="mx-auto w-full max-w-xl">
          {/* Clears the corner buttons (0.5rem + h-11 → bottom edge at 3.25rem)
              plus the safe-area inset they now sit below, since this view
              bleeds its own backdrop under the status bar. */}
          <div style={{ marginTop: ownsTopInset ? 'calc(var(--top-inset) + 3.5rem)' : '3.5rem' }}>
            <GameSwitcher current="wordle" />
          </div>

          {/* Hero */}
          <div className="text-center mb-5">
            <h1 className="text-title1 text-text-primary inline-flex items-start gap-1">
              Juice WRLD Wordle
              <span className="text-accent text-footnote font-bold mt-0.5">999</span>
            </h1>
            <p className="mt-1 text-subhead text-text-secondary">
              Guess the song title, letter by letter
            </p>
          </div>

          {/* Mode - the same segmented control as Heardle's. */}
          <div className="mb-2">
            <IosSegmented
              value={mode}
              options={MODES.map((m) => ({ value: m.id, label: m.label }))}
              onChange={setMode}
            />
          </div>

          <p className="text-center text-footnote text-text-muted mb-3">
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
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[var(--fill)] text-accent text-subhead font-semibold active:bg-[var(--fill-strong)] transition-colors disabled:opacity-40"
              >
                <RefreshCw size={14} /> Reroll
              </button>
            ) : (
              <div className="h-9" aria-hidden />
            )}
          </div>

          {poolLoading ? (
            <div className="flex flex-col items-center gap-3 py-24 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
              <p className="text-subhead">
                Loading the {categories.map((c) => POOL_LABELS[c].toLowerCase()).join(' + ')} catalogue…
              </p>
            </div>
          ) : poolError ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <AlertCircle size={22} className="text-red-400" />
              <p className="text-subhead text-text-secondary">Couldn't load the catalogue - {poolError}</p>
            </div>
          ) : !answer ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-subhead text-text-secondary">
                {rules.eras.length > 0
                  ? 'No titles match the eras you picked.'
                  : `No title in this pool has ${MIN_OPTIONS} others its length to play against.`}
              </p>
              {rules.eras.length > 0 && (
                <button
                  onClick={() => setSettings((s) => ({ ...s, eras: [] }))}
                  className="text-subhead font-semibold text-accent active:opacity-60"
                >
                  Clear era filter
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Board */}
              <div className="rounded-[20px] bg-[var(--grouped)] p-4 space-y-4">
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
                  <p className="text-center text-footnote text-red-500">{notice}</p>
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
                      <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                      <input
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setDropdownOpen(true) }}
                        onFocus={() => setDropdownOpen(true)}
                        onKeyDown={handleKeyDown}
                        placeholder={`or find a ${length}-letter title by name…`}
                        className="w-full h-11 pl-9 pr-3 rounded-full bg-[var(--fill)] border border-transparent text-body text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                      />
                      {dropdownOpen && suggestions.length > 0 && (
                        <div className="absolute bottom-full mb-2 left-0 right-0 max-h-64 overflow-y-auto rounded-2xl glass-thick z-20">
                          {suggestions.map((s, i) => {
                            const alias = matchedAlias(s, query)
                            return (
                              <button
                                key={s.id}
                                onClick={() => submitGuess(s)}
                                className={`w-full text-left px-4 py-2.5 flex items-center gap-2 transition-colors ${
                                  i === highlighted ? 'bg-accent/15' : 'active:bg-[var(--fill)]'
                                } ${alreadyGuessed(s) ? 'opacity-40' : ''}`}
                              >
                                <span className="min-w-0">
                                  <span className="block text-body text-text-primary truncate">{s.name}</span>
                                  {/* Why this row is here when the name doesn't
                                      match what was typed. */}
                                  {alias && (
                                    <span className="block text-caption1 text-text-muted truncate">aka {alias}</span>
                                  )}
                                </span>
                                {s.era && <span className="ml-auto shrink-0 text-footnote text-text-muted">{s.era}</span>}
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
                        className={`h-11 rounded-xl flex items-center gap-2.5 px-3.5 text-text-primary ${
                          correct
                            ? 'bg-accent/15'
                            : sameEra
                              ? 'bg-amber-500/15'
                              : 'bg-[var(--grouped)]'
                        }`}
                      >
                        {correct
                          ? <Check size={16} className="shrink-0 text-accent" />
                          : <X size={16} className="shrink-0 text-red-500" />}
                        <span className="text-body truncate">{guess.label}</span>
                        {!correct && sameEra && (
                          <span className="ml-auto shrink-0 text-footnote font-semibold text-amber-500">
                            Same era
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {finished && (
                <div className="mt-4 rounded-[20px] bg-[var(--grouped)] p-4">
                  <div className="flex gap-4">
                    {/* Art stays hidden until the round is over - era covers are
                        shared, so showing one early would narrow the field. */}
                    <div className="w-20 h-20 shrink-0 rounded-xl bg-[var(--fill)] overflow-hidden flex items-center justify-center">
                      {answer.song.imageUrl
                        ? <img src={smallCoverUrl(answer.song.imageUrl)} alt="" className="w-full h-full object-cover" />
                        : <Music2 size={28} className="text-text-muted" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-footnote font-semibold mb-0.5 ${status === 'won' ? 'text-accent' : 'text-red-500'}`}>
                        {status === 'won'
                          ? `Got it in ${guesses.length} ${guesses.length === 1 ? 'guess' : 'guesses'}`
                          : 'Out of guesses'}
                      </p>
                      <h2 className="text-title3 text-text-primary">{answer.song.name}</h2>
                      <p className="text-subhead text-text-secondary mt-0.5">
                        {[answer.song.era, CATEGORY_LABELS[answer.song.category] ?? answer.song.category,
                          answer.song.length].filter(Boolean).join(' · ')}
                      </p>
                      {/* The tiles carry the stripped title; the heading is the
                          catalogue's full name. Say so when they differ, or a
                          win on "Titanic" reading back as "Titanic (v2)" looks
                          like the game graded something else. */}
                      {/[([{]/.test(answer.song.name) && (
                        <p className="text-footnote text-text-muted mt-1.5">
                          Tiles spell <span className="font-mono">{answer.key}</span> - anything in brackets
                          is left off the board.
                        </p>
                      )}
                    </div>
                  </div>
                  {playError && (
                    <p className="text-footnote text-red-500 mt-3">Couldn't load that song. Check your connection.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-4">
                    <button
                      onClick={playFullSong}
                      className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full text-subhead font-semibold bg-accent text-white active:opacity-80 transition-opacity"
                    >
                      <Volume2 size={16} /> Play full song
                    </button>
                    {isDaily ? (
                      <button
                        onClick={share}
                        title="Share"
                        className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full text-subhead font-semibold bg-[var(--fill)] text-text-primary active:bg-[var(--fill-strong)] transition-colors"
                      >
                        <Share2 size={16} /> {copied ? 'Copied!' : 'Share'}
                      </button>
                    ) : (
                      <button
                        onClick={newRound}
                        className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full text-subhead font-semibold bg-[var(--fill)] text-text-primary active:bg-[var(--fill-strong)] transition-colors"
                      >
                        <RefreshCw size={16} /> Next title
                      </button>
                    )}
                    {isDaily && (
                      <span className="ml-auto text-footnote text-text-muted tabular-nums">
                        Next title in {formatCountdown(countdown)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {!finished && (
                <p className="text-center text-footnote text-text-muted mt-4 flex items-center justify-center gap-1.5">
                  <Type size={13} className="shrink-0" />
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
