import { useRef, useState } from 'react'
import { useContentMotion } from '../hooks/useContentMotion'
import LyricsGenJobView from './LyricsGenJobView'
import { AdminJobs } from './LyricsGenJobLists'

// Admin tab for lyrics generation: the Whisper model and everyone's jobs, the
// same as the Synced lyrics dialog's All jobs tab. A row opens the job in
// place, read and cancelled through the admin routes. The list stays mounted
// under an open job, so its filters are still set on the way back.

const noop = (): void => {}

export default function LyricsGenAdminTab(): JSX.Element {
  const [openJob, setOpenJob] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  useContentMotion(bodyRef, openJob ?? '')

  return (
    <div ref={bodyRef} className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl">
        {openJob && (
          <LyricsGenJobView
            key={openJob}
            jobId={openJob}
            admin
            audio={null}
            backLabel="All jobs"
            onBack={() => setOpenJob(null)}
            onContinue={noop}
            onRetry={noop}
            onDeleted={() => setOpenJob(null)}
          />
        )}
        <div className={openJob ? 'hidden' : ''}>
          <AdminJobs onOpen={setOpenJob} />
        </div>
      </div>
    </div>
  )
}
