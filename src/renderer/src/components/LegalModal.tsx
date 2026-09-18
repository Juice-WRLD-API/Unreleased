import { useState } from 'react'
import { X, ScrollText, ShieldCheck } from 'lucide-react'
import { ModalOverlay, LockToggle } from './Modal'

export type LegalDoc = 'terms' | 'privacy'

const LAST_UPDATED = 'September 18, 2026'

// ─── Small prose primitives ───────────────────────────────────────────────────

function H({ children }: { children: React.ReactNode }): JSX.Element {
  return <h3 className="text-text-primary font-semibold text-sm mt-5 first:mt-0 mb-1.5">{children}</h3>
}

function P({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="text-text-secondary text-xs leading-relaxed mb-2">{children}</p>
}

function List({ items }: { items: React.ReactNode[] }): JSX.Element {
  return (
    <ul className="mb-2 space-y-1">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-text-secondary text-xs leading-relaxed">
          <span className="text-accent mt-0.5 shrink-0">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

function Ext({ href, children }: { href: string; children: React.ReactNode }): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  )
}

// ─── Document content ─────────────────────────────────────────────────────────

function TermsContent(): JSX.Element {
  return (
    <div>
      <P>Last updated: {LAST_UPDATED}</P>

      <H>1. About this app</H>
      <P>
        unreleased (the &quot;App&quot;) is a free, fan-made music player for exploring Juice WRLD&apos;s catalogue. It
        is not affiliated with, endorsed by, or connected to Juice WRLD, his estate, Grade A Productions, Interscope
        Records, or any associated party. All music, artwork, names, and trademarks belong to their respective owners.
        The App is provided by the community that maintains it (&quot;we&quot;, &quot;us&quot;) at no cost.
      </P>

      <H>2. Acceptance and eligibility</H>
      <P>
        By installing or using the App you agree to these Terms. If you do not agree, do not use the App. You must be at
        least 13 years old (or the minimum age of digital consent in your country, if higher) to use the App. These Terms
        may change over time; continued use after a change means you accept the updated Terms.
      </P>

      <H>3. The App does not host content</H>
      <P>
        The App is a client - a viewer and player. It does not store, host, upload, or distribute any music, audio,
        artwork, or metadata itself. All such content is retrieved on demand from the third-party{' '}
        <Ext href="https://juicewrldapi.com">Juice WRLD API</Ext> and other third-party sources, which are operated
        independently of the App and are solely responsible for the content they make available. We do not own, control,
        endorse, or claim any rights in that content and cannot guarantee its accuracy, legality, completeness, or
        availability.
      </P>
      <P>
        The App is provided free of charge for personal, non-commercial use only. You are solely responsible for
        ensuring your use of the App and of any content accessed through it complies with the laws of your jurisdiction
        and with the rights of copyright holders. If you are not permitted to access particular content where you live,
        do not access it.
      </P>

      <H>4. Acceptable use</H>
      <List
        items={[
          'Use the App only for lawful, personal, non-commercial purposes.',
          'Do not sell, sublicense, or commercially exploit the App or any content accessed through it.',
          'Do not attempt to disrupt, overload, scrape abusively, circumvent security on, or reverse-engineer the App or the services it relies on.',
          'Do not use the App to infringe anyone’s intellectual property, privacy, or other rights.',
          'Do not redistribute, re-upload, or publicly perform content in violation of applicable law or the rights of copyright holders.',
        ]}
      />

      <H>5. Accounts</H>
      <P>
        Signing in is optional and handled through Discord. You are responsible for all activity under your account and
        for keeping your login secure. We may suspend or terminate access that abuses the service or breaches these
        Terms, at any time and without notice.
      </P>

      <H>6. Intellectual property &amp; copyright complaints</H>
      <P>
        We respect intellectual property rights and expect users to do the same. All music, lyrics, artwork, names, and
        trademarks are the property of their respective owners. Because the App does not host content, takedown requests
        are most effective when directed at the source hosting the material. That said, if you are a rights holder (or
        their agent) and believe content made accessible through the App infringes your rights, contact us through the
        channels below with a description of the work, where it appears, and your contact details, and we will act on
        your notice in good faith - including removing links or references within the App and forwarding the notice to
        the relevant data source. We will also address repeat infringement where we are able to.
      </P>

      <H>7. Disclaimer of warranties &amp; assumption of risk</H>
      <P>
        The App is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any kind, express or
        implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant
        that the App will be uninterrupted, error-free, or secure, or that any content will be accurate, lawful in your
        jurisdiction, or continuously available. You use the App and access any content through it at your own risk.
      </P>

      <H>8. Limitation of liability</H>
      <P>
        To the fullest extent permitted by law, the maintainers and contributors of the App are not liable for any
        indirect, incidental, special, consequential, or punitive damages, or for any loss of data, profits, or
        goodwill, arising from your use of (or inability to use) the App or any content accessed through it. The App is
        free, and to the extent any liability cannot be excluded, it is limited to the amount you paid to use the App -
        which is zero. Your sole and exclusive remedy for dissatisfaction is to stop using the App.
      </P>

      <H>9. Indemnification</H>
      <P>
        You agree to indemnify and hold harmless the maintainers and contributors of the App from any claims, damages,
        liabilities, and expenses (including reasonable legal fees) arising out of your use of the App, your violation
        of these Terms, or your violation of any law or the rights of any third party.
      </P>

      <H>10. Termination</H>
      <P>
        You may stop using the App at any time by uninstalling it or closing the page. We may modify, suspend, or
        discontinue the App (in whole or in part) at any time without notice or liability. Sections that by their nature
        should survive termination - including content disclaimers, warranty disclaimers, limitation of liability, and
        indemnification - will continue to apply.
      </P>

      <H>11. Governing law &amp; severability</H>
      <P>
        These Terms are governed by the laws applicable where the maintainers reside, without regard to conflict-of-law
        rules, and subject to any mandatory consumer-protection rights you have where you live. If any provision is found
        unenforceable, the remaining provisions stay in full effect and the unenforceable provision is limited to the
        minimum extent necessary.
      </P>

      <H>12. Changes</H>
      <P>
        We may update these Terms as the App evolves. Material changes will be reflected here with a new
        &quot;Last updated&quot; date.
      </P>

      <H>13. Contact</H>
      <P>
        Questions about these Terms, or copyright and takedown requests, can be raised on our{' '}
        <Ext href="https://discord.gg/jwa">Discord</Ext> or via the project&apos;s{' '}
        <Ext href="https://github.com/Juice-WRLD-API/Unreleased">GitHub</Ext>.
      </P>
    </div>
  )
}

function PrivacyContent(): JSX.Element {
  return (
    <div>
      <P>Last updated: {LAST_UPDATED}</P>

      <H>1. Overview</H>
      <P>
        This Privacy Policy explains what the unreleased App does with your data. In short: the App is designed to keep
        as much as possible on your own device, and to collect no more than is needed to play music and sync the
        features you choose to use.
      </P>

      <H>2. Data stored on your device</H>
      <P>
        Most of your data never leaves your device. The following are stored locally (in browser storage or, on the
        desktop app, on your file system):
      </P>
      <List
        items={[
          'Settings and preferences (theme, playback options, menu layout, equalizer, etc.) - if you are not signed in, this is the only place they live; if you are signed in, this is a local cache and the source of truth is your account (see section 5).',
          'Your local music library folders and tracks (desktop app only).',
          'Playback state, recently played, and cached artwork/metadata for speed.',
          'Your login token, if you sign in - kept locally to authenticate requests.',
        ]}
      />

      <H>3. Cookies &amp; local storage</H>
      <P>
        The App uses your browser&apos;s local storage (and, on the desktop app, local files) to function - for example
        to remember your settings, keep you signed in, and cache content for speed. These are strictly necessary for the
        App to work and are not used to track you across other websites or to build an advertising profile.
      </P>
      <P>
        We do not use third-party advertising or analytics cookies. Any cookies set by third-party services you reach
        through the App (for example the Juice WRLD API, Discord sign-in, or Last.fm) are governed by those services&apos;
        own policies. You can clear this storage at any time from Settings, or by clearing your browser data or
        uninstalling the desktop app - doing so resets your preferences and signs you out.
      </P>

      <H>4. Data sent to the Juice WRLD API</H>
      <P>
        Streaming and browsing music requires contacting the third-party{' '}
        <Ext href="https://juicewrldapi.com">Juice WRLD API</Ext>. Requests to it include standard technical details
        (such as your IP address and requested content) that any web service receives. When you play a track, an
        anonymous play event may be recorded to power play counts. This data is handled by that API under its own
        practices, which are outside our control.
      </P>

      <H>5. If you sign in</H>
      <P>Signing in with Discord is optional. If you do, the following may be associated with your account:</P>
      <List
        items={[
          'Your Discord username, ID, and avatar, used to identify your account.',
          'Your playlists, favorites, folders, and per-song preferences, synced so they follow you across devices.',
          'Your app settings (theme, layout, playback, equalizer, hotkeys, muted users/servers, etc.), synced the same way so they follow you across devices.',
          'Editor-related submissions (applications, edit proposals, reports) if you use those features.',
        ]}
      />
      <P>You can use the App without signing in; these syncing features simply stay local or unavailable.</P>

      <H>6. Optional integrations</H>
      <List
        items={[
          <>
            <strong className="text-text-primary font-medium">Last.fm scrobbling</strong> - if you connect Last.fm, the
            tracks you play are sent to Last.fm to scrobble under your account. Disconnect any time in Settings.
          </>,
          <>
            <strong className="text-text-primary font-medium">Discord status</strong> - the desktop app can show what
            you&apos;re listening to as your Discord activity. This runs locally with Discord and can be turned off.
          </>,
          <>
            <strong className="text-text-primary font-medium">GIF search in chat</strong> - if you use the GIF
            picker, what you type is sent to a third-party GIF provider (Tenor or Giphy) to fetch matching results,
            under that provider&apos;s own privacy policy.
          </>,
          <>
            <strong className="text-text-primary font-medium">Feedback &amp; reports</strong> - anything you submit
            (message, and optional contact you provide) is sent so we can act on it.
          </>,
        ]}
      />

      <H>7. What we do not do</H>
      <List
        items={[
          'We do not sell your data.',
          'We do not show third-party advertising or embed ad trackers.',
          'We do not ask for payment information - the App is free.',
        ]}
      />

      <H>8. Your choices</H>
      <P>
        You can clear the App&apos;s cached data and settings from Settings, or by clearing your browser storage /
        uninstalling the desktop app. Signing out removes your locally stored login token. To request removal of
        account-synced data, reach out through the channels below.
      </P>

      <H>9. Children</H>
      <P>
        The App is not directed at children under 13, and we do not knowingly collect personal information from them.
      </P>

      <H>10. Changes</H>
      <P>
        We may update this policy as the App evolves. Material changes will be reflected here with a new
        &quot;Last updated&quot; date.
      </P>

      <H>11. Contact</H>
      <P>
        For privacy questions or requests, reach us on{' '}
        <Ext href="https://discord.gg/jwa">Discord</Ext> or via{' '}
        <Ext href="https://github.com/Juice-WRLD-API/Unreleased">GitHub</Ext>.
      </P>
    </div>
  )
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

export default function LegalModal({ initialDoc = 'terms', onClose }: { initialDoc?: LegalDoc; onClose: () => void }): JSX.Element {
  const [doc, setDoc] = useState<LegalDoc>(initialDoc)

  const Tab = ({ id, icon: Icon, label }: { id: LegalDoc; icon: typeof ScrollText; label: string }): JSX.Element => (
    <button
      onClick={() => setDoc(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        doc === id
          ? 'bg-accent/15 text-accent border border-accent/25'
          : 'text-text-muted hover:text-text-primary bg-[var(--surface-overlay)] hover:bg-[var(--surface-raised)] border border-[var(--border)]'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  )

  return (
    <ModalOverlay
      onClose={onClose}
      zIndexClassName="z-[70]"
      panelClassName="bg-surface border border-[var(--border)] rounded-3xl shadow-2xl w-full max-w-[520px] h-[640px] max-h-[85vh]"
      minWidth={420} minHeight={420}
    >
      {({ onHandleMouseDown, locked, toggleLock, canLock }) => (
        <div className="w-full h-full flex flex-col overflow-hidden">
          <div
            className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0 cursor-grab active:cursor-grabbing"
            onMouseDown={onHandleMouseDown}
          >
            <div className="flex items-center gap-2">
              {doc === 'terms' ? <ScrollText size={16} className="text-accent" /> : <ShieldCheck size={16} className="text-accent" />}
              <h2 className="text-text-primary font-black text-lg tracking-tight">
                {doc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
              </h2>
            </div>
            <div className="flex items-center gap-1">
              {canLock && <LockToggle locked={locked} onClick={toggleLock} />}
              <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-6 py-3 border-b border-[var(--border)] shrink-0">
            <Tab id="terms" icon={ScrollText} label="Terms of Service" />
            <Tab id="privacy" icon={ShieldCheck} label="Privacy Policy" />
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {doc === 'terms' ? <TermsContent /> : <PrivacyContent />}
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
