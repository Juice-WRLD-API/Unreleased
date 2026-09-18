// Shared data/logic for the song editor page (EditorPage). Desktop and
// mobile wrap this in their own JSX/layout - keep behavior here.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore, useStorePick } from '../store/useStore'
import { apiFetch, JWApiSong, JWApiEra } from '../lib/juicewrldApi'
import * as userApi from '../lib/userApi'
import { isPrimaryChannelSlug } from './useChannelRoles'
import { invalidateLyricsCache } from '../components/Player'
import type { EditorApplication } from '../lib/userApi'
import {
  versionsEnabled, getOwnVersionMeta, setSongVersion, setGroupVersionTitle, setOwnVersionTitle,
  searchVersionTitles, joinVersionGroup, getVersionGroup,
} from '../lib/versionsApi'
import type { VersionTitleSuggestion } from '../lib/versionsApi'
import { invalidateCompactGroupsCache } from '../lib/compactGroups'
import { cleanDate, errorMessage } from '../lib/format'
import { diff, isGeniusUrl, extractGeniusLyrics } from '../lib/editorPageShared'

export type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error'
export type LyricsTab = 'lyrics' | 'synced'
export type DeleteState = 'idle' | 'confirm' | 'submitting' | 'submitted' | 'error'
export type VersionSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useEditorPageState(initialSongId: number | null = null) {
  const {
    account, currentTrack,
    pendingEditorSongId, setPendingEditorSongId, setActiveView, previousView,
    pendingEditProposal, setPendingEditProposal,
    setShowUserAuth, logoutAccount, activeChannel, channels,
  } = useStorePick('account', 'currentTrack', 'pendingEditorSongId', 'setPendingEditorSongId', 'setActiveView', 'previousView', 'pendingEditProposal', 'setPendingEditProposal', 'setShowUserAuth', 'logoutAccount', 'activeChannel', 'channels')
  // Where "back"/"nothing to edit" should return to - wherever the user was
  // before landing here, falling back to the editor dashboard when that's
  // unknown (e.g. a deep link straight into the editor).
  const backView = previousView && previousView !== 'editor' ? previousView : 'editor-profile'
  // Mirrored into a ref so the redirect effect below can read the latest value
  // without listing it as a dependency - setActiveView rewrites previousView,
  // which would otherwise re-run that effect and make it call itself forever.
  const backViewRef = useRef(backView)
  backViewRef.current = backView
  const isAdmin  = !!account?.is_administrator
  const canEdit  = userApi.isChannelEditor(account, activeChannel, isPrimaryChannelSlug(channels, activeChannel))

  const [application, setApplication] = useState<EditorApplication | null>(null)
  const [appLoading, setAppLoading]   = useState(false)

  const [song,    setSong]    = useState<JWApiSong | null>(null)
  const [loading, setLoading] = useState(false)
  // Set when a manual load (Edit click / proposal open) fails, so the
  // "nothing to edit" effect below doesn't silently bounce the user to My
  // Proposals - it used to swallow the fetch error entirely, making it look
  // like clicking Edit just redirected there for no reason.
  const [loadError, setLoadError] = useState<string | null>(null)
  const lastLoadIdRef = useRef<number | null>(null)
  const [eras,    setEras]    = useState<JWApiEra[]>([])
  // Set synchronously the instant a manual load (Edit click / proposal open)
  // is kicked off, before the async fetch resolves into `song`. Without this,
  // there's a render in between where pendingEditorSongId has already been
  // cleared to null but `song` hasn't been set yet - during that window the
  // "prefill from currently-playing track" effect below would incorrectly
  // fire and race the manual load, sometimes clobbering it with whatever's
  // currently playing.
  // Starts true when the caller already named a song (initialSongId), so the
  // prefill effect is blocked from the very first render rather than from the
  // first effect pass.
  const manualLoadRef = useRef(initialSongId != null)
  // Consumed once by the mount effect below; nulled so a later re-render can't
  // reopen it after the user has closed the song.
  const bootSongIdRef = useRef<number | null>(initialSongId)
  // True once a song/draft has actually been opened in this visit - lets the
  // "nothing to edit" redirect below tell "backed out of an edit" apart from
  // "landed here fresh with nothing pending" (the latter still goes to the
  // editor dashboard; the former should return to wherever the user came from).
  const wasEditingRef = useRef(false)

  const [name,     setName]     = useState('')
  const [artists,  setArtists]  = useState('')
  const [album,    setAlbum]    = useState('')
  const [cat,      setCat]      = useState('')
  const [eraId,    setEraId]    = useState('')
  const [prod,     setProd]     = useState('')
  const [eng,      setEng]      = useState('')
  const [loc,      setLoc]      = useState('')
  const [recDate,  setRecDate]  = useState('')
  const [relDate,  setRelDate]  = useState('')
  const [previewDate, setPreviewDate] = useState('')
  const [leak,     setLeak]     = useState('')
  const [dateLeaked, setDateLeaked] = useState('')
  const [lyrics,   setLyrics]   = useState('')
  const [synced,   setSynced]   = useState('')
  const [addInfo,  setAddInfo]  = useState('')
  const [notes,    setNotes]    = useState('')
  const [edNotes,  setEdNotes]  = useState('')

  const [imageUrl,          setImageUrl]          = useState('')
  const [filePath,          setFilePath]          = useState('')
  const [songLength,        setSongLength]        = useState('')
  const [bitrate,           setBitrate]           = useState('')
  const [bpm,               setBpm]               = useState('')
  const [musicalKey,        setMusicalKey]        = useState('')
  const [altNames,          setAltNames]          = useState('')
  const [fileNames,         setFileNames]         = useState('')
  const [instrumentals,     setInstrumentals]     = useState('')
  const [instrumentalNames, setInstrumentalNames] = useState('')
  const [sessionTitles,   setSessionTitles]   = useState('')
  const [sessionTracking, setSessionTracking] = useState('')

  const [lyricsTab,    setLyricsTab]    = useState<LyricsTab>('lyrics')
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [lyricsError,   setLyricsError]   = useState<string | null>(null)
  const [submitState,  setSubmitState]  = useState<SubmitState>('idle')
  const [submitError,  setSubmitError]  = useState<string | null>(null)
  // The patch (JSON-stringified) last successfully submitted, so the button
  // can stay disabled after submitState's 3s "submitted" flash resets back to
  // idle. Without this, an untouched proposal could be resubmitted verbatim
  // by clicking again once that flash wore off - nothing else marks the
  // still-pending proposal as "already sent" for this exact set of edits.
  // Cleared wherever the field state itself is reset (populate/cancel), since
  // a stale value there would just as wrongly block a legitimately new patch.
  const lastSubmittedPatchRef = useRef<string | null>(null)
  const [deleteState,  setDeleteState]  = useState<DeleteState>('idle')
  const [deleteError,  setDeleteError]  = useState<string | null>(null)
  const [showMore,     setShowMore]     = useState(false)
  // File picker for the audio path field (File URL / File path).
  const [pickingFile, setPickingFile] = useState(false)
  // File picker for the cover image field (Cover URL / Image URL).
  const [pickingImage, setPickingImage] = useState(false)
  // Synced lyrics as a timestamp+text table (default) or the raw LRC text.
  const [syncedTable,  setSyncedTable]  = useState(() => localStorage.getItem('editor:syncedFormat') !== 'raw')
  const [editingPropId, setEditingPropId] = useState<number | null>(null)
  // True while editing a 'create' proposal (new song) - has no backing song object yet
  const [isNewSongDraft, setIsNewSongDraft] = useState(false)

  // This song's own version label plus the group's shared version title -
  // linking songs together happens from the Tracker's multi-select "Link
  // versions" action (see ApiTrackerView.tsx), not here. These write
  // straight to juicewrldapi.com's /versions/ table (see lib/versionsApi.ts),
  // not through its proposal/review system, hence the separate save button
  // below rather than piggybacking on "Submit proposal". Version is
  // per-song ("v1", "TV Mix"); version title is written to every song in
  // the group at once so they always match - read-only everywhere else
  // (SongInfoModal no longer allows editing either field).
  const [versionNum,   setVersionNum]   = useState('')
  const [versionTitle, setVersionTitle] = useState('')
  const [ownGroupId,   setOwnGroupId]   = useState<number | null>(null)
  // The title as loaded, so a save can tell "renamed" from "left alone" - only
  // a real change retitles (and possibly splits) the song.
  const [loadedTitle,  setLoadedTitle]  = useState('')
  // Other songs sharing this song's group.
  const [linkedCount,  setLinkedCount]  = useState(0)
  const [versionSaveStatus, setVersionSaveStatus] = useState<VersionSaveStatus>('idle')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [titleSuggestions, setTitleSuggestions] = useState<VersionTitleSuggestion[]>([])
  const [showTitleSuggestions, setShowTitleSuggestions] = useState(false)
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const baseline = (s: JWApiSong | null): Record<string, unknown> => {
    if (!s) return {}
    return {
      // `name` is the API's own canonical title - NOT track_titles[0]. They
      // usually agree, but track_titles is an unordered alias list and for
      // ~6% of released songs its first entry is an alias, not the title
      // people know the song by (see heardle.ts's slim() for the same
      // mismatch). Populating the Title field from track_titles[0] meant the
      // editor sometimes showed - and would silently rewrite `name` to - an
      // alt title if the user touched the field without noticing.
      name:                   s.name,
      credited_artists:       s.credited_artists || '',
      album:                  s.album ?? s.era?.name ?? '',
      category:               s.category || '',
      era_id:                 s.era?.id ?? '',
      producers:              s.producers || '',
      engineers:              s.engineers || '',
      recording_locations:    s.recording_locations || '',
      record_dates:           s.record_dates || '',
      release_date:           cleanDate(s.release_date),
      preview_date:           cleanDate(s.preview_date),
      leak_type:              s.leak_type || '',
      date_leaked:            cleanDate(s.date_leaked),
      lyrics:                 s.lyrics || '',
      synced_lyrics:          s.synced_lyrics || '',
      additional_information: s.additional_information || '',
      notes:                  s.notes || '',
      image_url:              s.image_url || '',
      path:                   s.path || '',
      length:                 s.length || '',
      bitrate:                s.bitrate || '',
      bpm:                    s.bpm ?? '',
      key:                    s.key || '',
      track_titles:           s.track_titles || [],
      file_names:             s.file_names || '',
      instrumentals:          s.instrumentals || '',
      instrumental_names:     s.instrumental_names || '',
      session_titles:         s.session_titles || '',
      session_tracking:       s.session_tracking || '',
    }
  }

  const populate = useCallback((s: JWApiSong): void => {
    setName(s.name)
    setArtists(s.credited_artists || '')
    setAlbum(s.album ?? s.era?.name ?? '')
    setCat(s.category || '')
    setEraId(s.era?.id ? String(s.era.id) : '')
    setProd(s.producers || '')
    setEng(s.engineers || '')
    setLoc(s.recording_locations || '')
    setRecDate(s.record_dates || '')
    setRelDate(cleanDate(s.release_date))
    setPreviewDate(cleanDate(s.preview_date))
    setLeak(s.leak_type || '')
    setDateLeaked(cleanDate(s.date_leaked))
    setLyrics(s.lyrics || '')
    setSynced(s.synced_lyrics || '')
    setAddInfo(s.additional_information || '')
    setNotes(s.notes || '')
    setImageUrl(s.image_url || '')
    setFilePath(s.path || '')
    setSongLength(s.length || '')
    setBitrate(s.bitrate || '')
    setBpm(s.bpm != null ? String(s.bpm) : '')
    setMusicalKey(s.key || '')
    setAltNames((s.track_titles || []).join('\n'))
    setFileNames(s.file_names || '')
    setInstrumentals(s.instrumentals || '')
    setInstrumentalNames(s.instrumental_names || '')
    setSessionTitles(s.session_titles || '')
    setSessionTracking(s.session_tracking || '')
    setEdNotes('')
    setSubmitState('idle')
    setSubmitError(null)
    setDeleteState('idle')
    setDeleteError(null)
    lastSubmittedPatchRef.current = null
  }, [])

  const loadSong = useCallback(async (id: number): Promise<void> => {
    lastLoadIdRef.current = id
    setLoading(true)
    setLoadError(null)
    try {
      const s = await apiFetch<JWApiSong>(`/songs/${id}/`)
      setSong(s)
      populate(s)
    } catch (e) {
      setLoadError(errorMessage(e, 'Failed to load song'))
    } finally {
      setLoading(false)
      // Once a load completes (success or failure), `song` (if set) already
      // blocks the currently-playing prefill effect on its own - the ref's
      // job was only to cover the race window while this was in flight.
      manualLoadRef.current = false
    }
  }, [populate])

  useEffect(() => {
    if (!canEdit) return
    apiFetch<JWApiEra[] | { results: JWApiEra[] }>('/eras/')
      .then(d => setEras(Array.isArray(d) ? d : (d as { results: JWApiEra[] }).results ?? []))
      .catch(() => undefined)
  }, [canEdit])

  useEffect(() => {
    if (!versionsEnabled || !song) {
      setVersionNum(''); setVersionTitle(''); setOwnGroupId(null)
      setLoadedTitle(''); setLinkedCount(0)
      return
    }
    getOwnVersionMeta(song.id).then(meta => {
      setVersionNum(meta?.version ?? '')
      setVersionTitle(meta?.versionTitle ?? '')
      setLoadedTitle(meta?.versionTitle ?? '')
      setOwnGroupId(meta?.groupId ?? null)
    })
    // How many other songs share this song's group - decides whether a retitle
    // renames in place or splits this song out, and is shown as a hint below.
    getVersionGroup(song.id).then(g => setLinkedCount(g.length))
  }, [song])

  useEffect(() => {
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current)
    titleDebounceRef.current = setTimeout(() => {
      searchVersionTitles(versionTitle).then(setTitleSuggestions)
    }, 250)
    return () => { if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current) }
  }, [versionTitle])

  const saveVersionInfo = async (): Promise<void> => {
    if (!song) return
    setVersionSaveStatus('saving')
    setLinkError(null)
    try {
      const groupId = await setSongVersion(song.id, versionNum.trim() || null, ownGroupId)
      const nextTitle = versionTitle.trim()
      // Only touch titles when the field actually changed - saving a version
      // number alone must not split the song out of its group. A changed title
      // retitles this song only: setOwnVersionTitle moves it to a group of its
      // own when it shares one, leaving the other members' title alone.
      if (nextTitle !== loadedTitle) {
        const nextGroupId = await setOwnVersionTitle(song.id, nextTitle || null, groupId)
        setOwnGroupId(nextGroupId)
        setLoadedTitle(nextTitle)
        if (nextGroupId !== groupId) setLinkedCount(0)
      } else {
        setOwnGroupId(groupId)
      }
      invalidateCompactGroupsCache()
      setVersionSaveStatus('saved')
    } catch (e) {
      setLinkError(errorMessage(e, 'Failed to save version info'))
      setVersionSaveStatus('error')
    }
    setTimeout(() => setVersionSaveStatus('idle'), 2500)
  }

  // Picking an existing title from the autocomplete means "this song belongs
  // with that group" - so it joins the group behind that title (merging like
  // linkSongVersion does) rather than just copying the text, otherwise two
  // songs could show the same title while sitting in different groups.
  const handlePickTitleSuggestion = async (suggestion: VersionTitleSuggestion): Promise<void> => {
    if (!song) return
    setVersionTitle(suggestion.title)
    setShowTitleSuggestions(false)
    setVersionSaveStatus('saving')
    setLinkError(null)
    try {
      const groupId = await joinVersionGroup(song.id, suggestion.groupId)
      await setGroupVersionTitle(groupId, suggestion.title)
      invalidateCompactGroupsCache()
      setOwnGroupId(groupId)
      // Joining adopts the group's title, so the next plain save mustn't read
      // that as a rename and split the song straight back out.
      setLoadedTitle(suggestion.title)
      getVersionGroup(song.id).then(g => setLinkedCount(g.length))
      setVersionSaveStatus('saved')
    } catch (e) {
      setLinkError(errorMessage(e, 'Failed to join version group'))
      setVersionSaveStatus('error')
    }
    setTimeout(() => setVersionSaveStatus('idle'), 2500)
  }

  // The song this page was mounted for, if the caller named one. Kept until
  // canEdit is known, since an account still loading would otherwise drop it.
  useEffect(() => {
    const id = bootSongIdRef.current
    if (id == null || !canEdit) return
    bootSongIdRef.current = null
    loadSong(id)
  }, [canEdit, loadSong])

  useEffect(() => {
    if (!pendingEditorSongId || !canEdit) return
    manualLoadRef.current = true
    const id = pendingEditorSongId
    setPendingEditorSongId(null)
    loadSong(id)
  }, [pendingEditorSongId, canEdit, setPendingEditorSongId, loadSong])

  useEffect(() => {
    // Don't hijack a new-song draft (or an about-to-be-applied edit proposal)
    // with whatever happens to be playing - this raced with the
    // pendingEditProposal effect below and clobbered the draft once the
    // currently-playing track's fetch resolved a moment later. manualLoadRef
    // closes a second race: pendingEditorSongId/pendingEditProposal clear to
    // null synchronously before their loadSong() promise resolves into
    // `song`, leaving a render where this effect's guard would otherwise
    // wrongly see "nothing pending" and prefill from whatever's playing.
    if (!canEdit || song || pendingEditorSongId || isNewSongDraft || pendingEditProposal || manualLoadRef.current) return
    if (!currentTrack) return
    const id = userApi.trackIdToSongId(currentTrack.id)
    if (id) loadSong(id)
  }, [canEdit, song, currentTrack, pendingEditorSongId, isNewSongDraft, pendingEditProposal, loadSong])

  // Landing here with nothing to edit (no song playing, no pending proposal/
  // draft) used to show a static "No song selected" placeholder - send editors
  // to My Proposals instead, which is actually useful to land on. Runs after
  // the prefill effect above so `loading` is already true if a currently-
  // playing track's song is still being fetched.
  useEffect(() => {
    // manualLoadRef guards a cross-store race: the Edit-click load effect above
    // clears pendingEditorSongId (Zustand) and flips `loading` on (React state)
    // in the same tick, but those commit in separate passes - leaving a render
    // where pendingEditorSongId is already null yet `loading` is still false.
    // Without this guard that window looked like "nothing to edit" and bounced
    // the user to My Proposals the instant they clicked Edit. The ref is set
    // synchronously before that window opens and cleared once loadSong settles
    // (by which point `song`/`loadError` block this effect on their own).
    //
    // A pop-out editor window is exempt: it renders whatever its URL names, so
    // activeView means nothing there and it never unmounts this page. It used
    // to spin here - setActiveView changes previousView, previousView changes
    // backView, backView re-ran this effect - until React gave up with
    // "maximum update depth exceeded". It shows "No song selected" instead.
    // backView is read from a ref for the same reason: it must not be able to
    // re-trigger the very effect that changes it.
    if (!canEdit || loading || song || isNewSongDraft || pendingEditorSongId || pendingEditProposal || loadError || manualLoadRef.current) return
    setActiveView(wasEditingRef.current ? backViewRef.current : 'editor-profile')
  }, [canEdit, loading, song, isNewSongDraft, pendingEditorSongId, pendingEditProposal, loadError, setActiveView])

  useEffect(() => {
    if (song || isNewSongDraft) wasEditingRef.current = true
  }, [song, isNewSongDraft])

  useEffect(() => {
    if (!pendingEditProposal || !canEdit) return
    manualLoadRef.current = true
    const { id, songId, proposedData: d, editorNotes } = pendingEditProposal
    setPendingEditProposal(null)
    setEditingPropId(id)

    const applyProposedData = (): void => {
      if ('name' in d)                   setName(String(d.name ?? ''))
      if ('credited_artists' in d)        setArtists(String(d.credited_artists ?? ''))
      if ('album' in d)                   setAlbum(String(d.album ?? ''))
      if ('category' in d)               setCat(String(d.category ?? ''))
      if ('era_id' in d)                 setEraId(d.era_id != null ? String(d.era_id) : '')
      if ('producers' in d)              setProd(String(d.producers ?? ''))
      if ('engineers' in d)              setEng(String(d.engineers ?? ''))
      if ('recording_locations' in d)    setLoc(String(d.recording_locations ?? ''))
      if ('record_dates' in d)           setRecDate(String(d.record_dates ?? ''))
      if ('release_date' in d)           setRelDate(String(d.release_date ?? ''))
      if ('preview_date' in d)           setPreviewDate(String(d.preview_date ?? ''))
      if ('leak_type' in d)              setLeak(String(d.leak_type ?? ''))
      if ('date_leaked' in d)            setDateLeaked(String(d.date_leaked ?? ''))
      if ('lyrics' in d)                 setLyrics(String(d.lyrics ?? ''))
      if ('synced_lyrics' in d)           setSynced(String(d.synced_lyrics ?? ''))
      if ('additional_information' in d) setAddInfo(String(d.additional_information ?? ''))
      if ('notes' in d)                  setNotes(String(d.notes ?? ''))
      if ('image_url' in d)              setImageUrl(String(d.image_url ?? ''))
      if ('path' in d)                   setFilePath(String(d.path ?? ''))
      if ('length' in d)                 setSongLength(String(d.length ?? ''))
      if ('bitrate' in d)                setBitrate(String(d.bitrate ?? ''))
      if ('bpm' in d)                    setBpm(d.bpm != null ? String(d.bpm) : '')
      if ('key' in d)                    setMusicalKey(String(d.key ?? ''))
      if ('track_titles' in d)           setAltNames(Array.isArray(d.track_titles) ? (d.track_titles as string[]).join('\n') : String(d.track_titles ?? ''))
      if ('file_names' in d)             setFileNames(String(d.file_names ?? ''))
      if ('instrumentals' in d)          setInstrumentals(String(d.instrumentals ?? ''))
      if ('instrumental_names' in d)     setInstrumentalNames(String(d.instrumental_names ?? ''))
      if ('session_titles' in d)         setSessionTitles(String(d.session_titles ?? ''))
      if ('session_tracking' in d)       setSessionTracking(String(d.session_tracking ?? ''))
      setEdNotes(editorNotes)
    }

    if (songId == null) {
      // 'create' proposal - new song, no backing song record exists yet
      setSong(null)
      setIsNewSongDraft(true)
      // Doesn't go through populate() (there's no song to populate from), so
      // clear this by hand - otherwise a leftover value from whatever was
      // open before could, in a rare coincidence, match this draft's patch
      // and wrongly show it as already submitted.
      lastSubmittedPatchRef.current = null
      applyProposedData()
    } else {
      setIsNewSongDraft(false)
      loadSong(songId).then(applyProposedData)
    }
  }, [pendingEditProposal, canEdit, setPendingEditProposal, loadSong])

  useEffect(() => {
    if (!account || canEdit) { setApplication(null); return }
    setAppLoading(true)
    userApi.getMyApplication('editor', activeChannel)
      .then(r => setApplication(r.application))
      .catch(() => setApplication(null))
      .finally(() => setAppLoading(false))
  }, [account, canEdit, activeChannel])

  const base = baseline(song)
  const current: Record<string, unknown> = {
    name, credited_artists: artists, album, category: cat,
    era_id: eraId ? Number(eraId) : '',
    producers: prod, engineers: eng,
    recording_locations: loc, record_dates: recDate,
    release_date: relDate, preview_date: previewDate, leak_type: leak,
    date_leaked: dateLeaked,
    lyrics, synced_lyrics: synced,
    additional_information: addInfo, notes,
    image_url: imageUrl,
    path: filePath,
    length: songLength,
    bitrate,
    bpm: bpm.trim() ? Number(bpm) : '',
    key: musicalKey,
    track_titles: altNames ? altNames.split('\n').map(s => s.trim()).filter(Boolean) : [],
    file_names: fileNames,
    instrumentals,
    instrumental_names: instrumentalNames,
    session_titles: cat === 'recording_session' ? sessionTitles : '',
    session_tracking: cat === 'recording_session' ? sessionTracking : '',
  }
  const patch        = diff(baseline(song), current)
  const changedCount = Object.keys(patch).length
  // True once changedCount > 0 has already been sent and nothing has been
  // edited since - see lastSubmittedPatchRef above.
  const alreadySubmitted = changedCount > 0 && JSON.stringify(patch) === lastSubmittedPatchRef.current

  const cancelEditProposal = (): void => {
    setEditingPropId(null)
    setIsNewSongDraft(false)
    lastSubmittedPatchRef.current = null
    if (song) populate(song)
  }

  const closeSong = (): void => {
    setSong(null); setEditingPropId(null); setIsNewSongDraft(false); setDeleteState('idle'); setDeleteError(null)
  }

  const submit = async (): Promise<void> => {
    if ((!song && !isNewSongDraft) || changedCount === 0 || alreadySubmitted) return
    setSubmitState('submitting')
    setSubmitError(null)
    try {
      if (editingPropId != null) {
        // Already a live pending proposal on the server - editing it further
        // updates that proposal directly rather than staging a second one.
        await userApi.updateProposal(editingPropId, { proposed_data: patch, editor_notes: edNotes })
        setEditingPropId(null)
        setIsNewSongDraft(false)
        if (song && ('lyrics' in patch || 'synced_lyrics' in patch)) invalidateLyricsCache(song.id)
      } else if (song) {
        useStore.getState().stageSongChanges([{
          songId: song.id, changeType: 'update',
          title: name || song.name, proposedData: patch, editorNotes: edNotes,
          channel: activeChannel,
        }])
      }
      // Lyrics cache invalidation for an update happens once it's actually
      // proposed (see compStagedSongChanges) - staging alone changes nothing
      // server-side yet.
      lastSubmittedPatchRef.current = JSON.stringify(patch)
      setSubmitState('submitted')
      setTimeout(() => setSubmitState('idle'), 3000)
    } catch (e) {
      setSubmitState('error')
      setSubmitError(errorMessage(e, 'Submission failed'))
      setTimeout(() => setSubmitState('idle'), 4000)
    }
  }

  const submitDeletion = async (): Promise<void> => {
    if (!song) return
    if (deleteState !== 'confirm') { setDeleteState('confirm'); return }
    setDeleteState('submitting')
    setDeleteError(null)
    try {
      useStore.getState().stageSongChanges([{
        songId: song.id, changeType: 'delete',
        title: name || song.name, proposedData: {}, editorNotes: edNotes,
        channel: activeChannel,
      }])
      setDeleteState('submitted')
      setTimeout(() => setDeleteState('idle'), 3000)
    } catch (e) {
      setDeleteState('error')
      setDeleteError(errorMessage(e, 'Submission failed'))
      setTimeout(() => setDeleteState('idle'), 4000)
    }
  }

  const handleLyricsPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const pasted = e.clipboardData.getData('text')
    if (!pasted) return

    // ── Genius URL → fetch lyrics ──────────────────────────────────────────
    if (isGeniusUrl(pasted)) {
      e.preventDefault()
      setLyricsLoading(true)
      setLyricsError(null)
      try {
        const url = pasted.trim()
        // Try allorigins first, fall back to corsproxy
        const proxies = [
          `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
          `https://corsproxy.io/?${encodeURIComponent(url)}`,
        ]
        let html: string | null = null
        let lastErr = ''
        for (const proxy of proxies) {
          try {
            const res = await fetch(proxy)
            if (!res.ok) { lastErr = `HTTP ${res.status}`; continue }
            html = await res.text()
            break
          } catch (err) {
            lastErr = String(err)
          }
        }
        if (!html) throw new Error(lastErr || 'All proxies failed')
        setLyrics(extractGeniusLyrics(html))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setLyricsError(`Could not fetch lyrics: ${msg}`)
        setTimeout(() => setLyricsError(null), 6000)
      } finally {
        setLyricsLoading(false)
      }
      return
    }

    // ── Genius-style [tags] → strip ────────────────────────────────────────
    if (!/\[.*?\]/.test(pasted)) return
    e.preventDefault()
    const cleaned = pasted
      .replace(/\r\n/g, '\n')
      .replace(/^\[.*?\]\n?/gm, '')
      .replace(/\n{2,}/g, '\n\n')
      .trim()
    const el = e.currentTarget
    const start = el.selectionStart ?? lyrics.length
    const end   = el.selectionEnd   ?? lyrics.length
    setLyrics(lyrics.substring(0, start) + cleaned + lyrics.substring(end))
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + cleaned.length })
  }

  const onSubmitted = useCallback((a: EditorApplication) => setApplication(a), [])
  const onSignOut   = useCallback(() => logoutAccount(), [logoutAccount])

  return {
    account, isAdmin, canEdit, backView, setActiveView, activeChannel, channels,
    application, appLoading, onSubmitted, onSignOut, setShowUserAuth, logoutAccount,

    song, loading, loadError, lastLoadIdRef, loadSong, eras,
    isNewSongDraft, editingPropId, cancelEditProposal, closeSong,

    name, setName, artists, setArtists, album, setAlbum, cat, setCat, eraId, setEraId,
    prod, setProd, eng, setEng, loc, setLoc, recDate, setRecDate, relDate, setRelDate,
    previewDate, setPreviewDate, leak, setLeak, dateLeaked, setDateLeaked,
    lyrics, setLyrics, synced, setSynced, addInfo, setAddInfo, notes, setNotes, edNotes, setEdNotes,
    imageUrl, setImageUrl, filePath, setFilePath, songLength, setSongLength, bitrate, setBitrate,
    bpm, setBpm, musicalKey, setMusicalKey, altNames, setAltNames, fileNames, setFileNames,
    instrumentals, setInstrumentals, instrumentalNames, setInstrumentalNames,
    sessionTitles, setSessionTitles, sessionTracking, setSessionTracking,

    lyricsTab, setLyricsTab, lyricsLoading, lyricsError, handleLyricsPaste,
    syncedTable, setSyncedTable,

    submitState, submitError, submit,
    deleteState, setDeleteState, deleteError, submitDeletion,
    showMore, setShowMore,
    pickingFile, setPickingFile, pickingImage, setPickingImage,

    versionNum, setVersionNum, versionTitle, setVersionTitle, ownGroupId,
    loadedTitle, linkedCount, versionSaveStatus, linkError, saveVersionInfo,
    titleSuggestions, showTitleSuggestions, setShowTitleSuggestions, handlePickTitleSuggestion,

    base, current, patch, changedCount, alreadySubmitted,
  }
}
