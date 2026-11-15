import { useEffect, useState } from 'react'
import { ArrowDownCircle, HardDrive, Loader2, Trash2 } from 'lucide-react'
import { GroupedRow, GroupedSection } from './mobile/Grouped'
import { useOfflineStore } from '../store/useOfflineStore'
import { offlineBytes, offlineNeedsInstall, offlineSupported, refreshOfflineUsage, removeAllOffline } from '../lib/offlineDownloads'
import { formatBytes } from '../lib/format'
import { showAppToast } from '../lib/appToast'
import { useStore } from '../store/useStore'

// Settings → Playback → Downloads: what's saved for offline play, how much
// room it takes, and removing it. Only drawn where downloads exist as a
// feature (the installed iOS app), plus a one-line pointer in a Safari tab.

export default function OfflineDownloadsSettings(): JSX.Element | null {
  const playlists = useOfflineStore((s) => s.playlists)
  const usage = useOfflineStore((s) => s.usage)
  const trackCount = useOfflineStore((s) => s.trackIds.size)
  const [bytes, setBytes] = useState<number | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const supported = offlineSupported()

  useEffect(() => {
    if (!supported) return
    void refreshOfflineUsage()
    void offlineBytes().then(setBytes).catch(() => setBytes(null))
  }, [supported, trackCount])

  if (!supported) {
    if (!offlineNeedsInstall()) return null
    return (
      <GroupedSection header="Downloads" className="mb-6" footer="Add this app to your Home Screen (Share → Add to Home Screen) to download playlists and play them with no connection.">
        <GroupedRow icon={ArrowDownCircle} iconColor="#16a34a" label="Offline playlists" sub="Available in the installed app" chevron={false} />
      </GroupedSection>
    )
  }

  const list = Object.values(playlists).sort((a, b) => a.name.localeCompare(b.name))
  const openPlaylist = (id: number): void => {
    const s = useStore.getState()
    s.setPlaylistsSelectedLocalId(null)
    s.setPlaylistsSelectedId(id)
    s.setActiveView('playlists')
  }

  return (
    <GroupedSection
      header="Downloads"
      className="mb-6"
      footer={list.length
        ? 'Downloaded playlists stay up to date: songs added to them download the next time the app is open and online.'
        : 'Open a playlist and choose Download from its ⋯ menu to play it with no connection.'}
    >
      <GroupedRow
        icon={HardDrive}
        iconColor="#6b7280"
        label="Space used"
        sub={usage && usage.quota > 0 ? `${formatBytes(usage.quota - usage.used)} still available to this app` : undefined}
        detail={bytes == null ? '…' : `${formatBytes(bytes)} · ${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`}
        chevron={false}
      />
      {list.map((p) => {
        const active = p.status === 'queued' || p.status === 'downloading'
        return (
          <GroupedRow
            key={p.id}
            leading={<span className="w-[29px] h-[29px] flex items-center justify-center text-accent shrink-0">
              {active ? <Loader2 size={18} className="animate-spin" /> : <ArrowDownCircle size={20} />}
            </span>}
            label={p.name || 'Playlist'}
            sub={active ? `Downloading ${p.done} of ${p.total}` : p.status === 'error' ? (p.error ?? 'Download failed') : `${p.done} of ${p.total} songs`}
            onClick={() => openPlaylist(p.id)}
          />
        )
      })}
      {list.length > 0 && (
        <GroupedRow
          icon={Trash2}
          iconColor="#dc2626"
          label={confirmAll ? 'Tap again to remove every download' : 'Remove all downloads'}
          danger
          chevron={false}
          onClick={() => {
            if (!confirmAll) { setConfirmAll(true); window.setTimeout(() => setConfirmAll(false), 4000); return }
            setConfirmAll(false)
            void removeAllOffline().then(() => showAppToast('All downloads removed'))
          }}
        />
      )}
    </GroupedSection>
  )
}
