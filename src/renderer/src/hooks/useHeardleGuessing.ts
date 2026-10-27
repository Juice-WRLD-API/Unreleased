// The Heardle guess box - search suggestions, keyboard nav, and the
// submit/skip flow (server-graded or local). Identical between the desktop
// and mobile views except which state a round-start/guess API error lands
// in (desktop: roundError, mobile: reuses poolError) - that's passed in as
// onApiError rather than baked in here.
import { useEffect, useMemo, useState } from 'react'
import {
  searchPool, isCorrectGuess,
} from '../lib/heardle'
import type { HeardleSong, Guess, GameStatus, VersionMap } from '../lib/heardle'
import {
  submitGuess as apiSubmitGuess, skipGuess as apiSkipGuess,
} from '../lib/heardleApi'
import type { PuzzleResponse } from '../lib/heardleApi'

export function useHeardleGuessing(params: {
  playablePool: HeardleSong[]
  answer: HeardleSong | null
  versions: VersionMap
  ladder: number[]
  finished: boolean
  useServerRound: boolean
  roundToken: string | null
  applyServerPuzzle: (res: PuzzleResponse) => void
  stopPlayback: () => void
  guesses: Guess[]
  setGuesses: React.Dispatch<React.SetStateAction<Guess[]>>
  setStatus: (status: GameStatus) => void
  onApiError: (message: string) => void
}): {
  query: string
  setQuery: (v: string) => void
  highlighted: number
  setHighlighted: React.Dispatch<React.SetStateAction<number>>
  dropdownOpen: boolean
  setDropdownOpen: (v: boolean) => void
  suggestions: HeardleSong[]
  submitGuess: (song: HeardleSong) => void
  skip: () => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
} {
  const {
    playablePool, answer, versions, ladder, finished, useServerRound, roundToken,
    applyServerPuzzle, stopPlayback, guesses, setGuesses, setStatus, onApiError,
  } = params

  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // ── Guessing ───────────────────────────────────────────────────────────────
  // Suggestions come from the filtered pool: under an era filter, songs that
  // can't be the answer shouldn't be offered as guesses.
  const suggestions = useMemo(
    () => (query.trim() ? searchPool(playablePool, query, 50) : []),
    [playablePool, query])

  useEffect(() => { setHighlighted(0) }, [query])

  const commitGuess = (guess: Guess): void => {
    stopPlayback()
    const next = [...guesses, guess]
    setGuesses(next)
    if (next.length >= ladder.length) setStatus('lost')
    setQuery('')
    setDropdownOpen(false)
  }

  const submitGuess = (song: HeardleSong): void => {
    if (finished) return
    if (useServerRound && roundToken) {
      stopPlayback()
      apiSubmitGuess(roundToken, song.id)
        .then(applyServerPuzzle)
        .catch((err: Error) => onApiError(err.message))
      setQuery('')
      setDropdownOpen(false)
      return
    }
    if (!answer) return
    if (isCorrectGuess(song, answer, versions)) {
      stopPlayback()
      setGuesses((prev) => [...prev, {
        songId: song.id,
        label: song.name,
        era: song.era,
        sameEra: false,
        viaVersion: song.id !== answer.id,
      }])
      setStatus('won')
      setQuery('')
      setDropdownOpen(false)
      return
    }
    commitGuess({
      songId: song.id,
      label: song.name,
      era: song.era,
      sameEra: !!song.era && song.era === answer.era,
    })
  }

  const skip = (): void => {
    if (finished) return
    if (useServerRound && roundToken) {
      stopPlayback()
      apiSkipGuess(roundToken).then(applyServerPuzzle).catch((err: Error) => onApiError(err.message))
      return
    }
    if (!answer) return
    commitGuess({ songId: null, label: 'Skipped', era: null, sameEra: false })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((i) => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const s = suggestions[highlighted]; if (s) submitGuess(s) }
    else if (e.key === 'Escape') { setDropdownOpen(false) }
  }

  return { query, setQuery, highlighted, setHighlighted, dropdownOpen, setDropdownOpen, suggestions, submitGuess, skip, handleKeyDown }
}
