import { useState } from 'react'
import { ArrowLeft, Plus, Check, Copy } from 'lucide-react'
import Markdown from './Markdown'

// Formatting guide shown inside the news composer. Every example is real
// source that the post renderer (Markdown.tsx: react-markdown + GFM, no raw
// HTML) turns into the preview next to it, so what you see is exactly what a
// published post looks like. "Insert" drops the snippet into the body at the
// cursor.

interface Example {
  label: string
  source: string
  note?: string
}

interface Section {
  id: string
  title: string
  intro?: string
  examples: Example[]
}

const SECTIONS: Section[] = [
  {
    id: 'text',
    title: 'Text styles',
    intro: 'Wrap words in symbols to style them. Stars and underscores both work.',
    examples: [
      { label: 'Bold', source: 'This is **bold** text.' },
      { label: 'Italic', source: 'This is _italic_ text (or *italic*).' },
      { label: 'Bold + italic', source: 'This is ***bold and italic***.' },
      { label: 'Strikethrough', source: 'Release date: ~~Friday~~ Saturday.' },
      { label: 'Inline code', source: 'Run the `/news` command in the terminal.' },
      {
        label: 'Mixing styles',
        source: 'The **new player** is _much_ faster, and ~~bugs~~ are **_gone_**.',
      },
    ],
  },
  {
    id: 'paragraphs',
    title: 'Paragraphs & line breaks',
    intro: 'A single Enter does NOT start a new line in the published post: lines are joined into one paragraph. Leave a blank line between paragraphs.',
    examples: [
      {
        label: 'Two paragraphs',
        source: 'First paragraph. It can be as long as you like.\n\nSecond paragraph, after a blank line.',
      },
      {
        label: 'Single Enter (joined)',
        source: 'These two lines\nend up on the same line.',
        note: 'No blank line between them, so they merge.',
      },
      {
        label: 'Forced line break',
        source: 'End a line with a backslash\\\nto break it without a new paragraph.',
        note: 'A trailing backslash (or two trailing spaces) forces a line break.',
      },
    ],
  },
  {
    id: 'headings',
    title: 'Headings',
    intro: 'Start a line with # signs and a space. Use them to split long posts into sections. The post title is already shown above the body, so most posts start at ##.',
    examples: [
      { label: 'Large heading', source: '# Big announcement' },
      { label: 'Section heading', source: '## What changed' },
      { label: 'Sub-section', source: '### Bug fixes' },
    ],
  },
  {
    id: 'links',
    title: 'Links',
    intro: 'Links open in a new tab. Only http, https and mailto links are clickable; anything else shows as plain text.',
    examples: [
      { label: 'Link with text', source: 'Read the [full changelog](https://example.com/changelog).' },
      { label: 'Bare URL', source: 'Visit https://example.com for details.', note: 'URLs are linked automatically.' },
      { label: 'Email link', source: 'Questions? [Email us](mailto:team@example.com).' },
      { label: 'Bold link', source: '**[Download the update](https://example.com/download)**' },
    ],
  },
  {
    id: 'images',
    title: 'Images',
    intro: 'Same as a link with a ! in front. The text in brackets describes the image for screen readers. Images must be hosted at an https URL; for files on your computer use Attachments or the cover image instead.',
    examples: [
      {
        label: 'Image',
        source: '![Album artwork](https://picsum.photos/seed/unreleased/640/280)',
      },
      {
        label: 'Clickable image',
        source: '[![Preview](https://picsum.photos/seed/preview/640/200)](https://example.com)',
        note: 'Wrap an image in a link to make it clickable.',
      },
    ],
  },
  {
    id: 'lists',
    title: 'Lists',
    intro: 'Start lines with -, * or a number and a period. Indent by two or more spaces to nest.',
    examples: [
      { label: 'Bulleted list', source: '- Faster search\n- New themes\n- Offline downloads' },
      { label: 'Numbered list', source: '1. Open Settings\n2. Go to Appearance\n3. Pick a theme' },
      {
        label: 'Nested list',
        source: '- Player\n  - Gapless playback\n  - Crossfade\n- Library\n  - Smart playlists',
      },
      {
        label: 'Numbered with sub-points',
        source: '1. Update the app\n   - Desktop: restart it\n   - Web: refresh the page\n2. Sign in again',
      },
      {
        label: 'List item with a paragraph',
        source: '- **Search**\n\n  Results now load as you type.\n\n- **Queue**\n\n  Drag songs to reorder.',
        note: 'Indent the paragraph to keep it inside the list item.',
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Checklists',
    intro: 'A list item starting with [ ] or [x] becomes a checkbox. Good for roadmaps and progress updates.',
    examples: [
      {
        label: 'Checklist',
        source: '- [x] Lyrics view\n- [x] Sleep timer\n- [ ] Car mode\n- [ ] Widgets',
      },
    ],
  },
  {
    id: 'quotes',
    title: 'Quotes',
    intro: 'Start a line with >. Add > on blank lines to keep a multi-paragraph quote together.',
    examples: [
      { label: 'Quote', source: '> This is the best update yet.' },
      {
        label: 'Quote with attribution',
        source: '> Music is my therapy.\n>\n> — Someone on the forum',
      },
      {
        label: 'Formatting inside a quote',
        source: '> **Heads up:** the old links stop working on _Monday_.',
      },
    ],
  },
  {
    id: 'code',
    title: 'Code blocks',
    intro: 'Put three backticks on the lines before and after. Formatting inside is shown as-is, which also makes it handy for showing literal text.',
    examples: [
      {
        label: 'Code block',
        source: '```\nnews list --channel updates\nnews show 42\n```',
      },
      {
        label: 'With a language',
        source: '```json\n{ "theme": "midnight", "volume": 80 }\n```',
        note: 'The language name after the backticks is optional.',
      },
    ],
  },
  {
    id: 'tables',
    title: 'Tables',
    intro: 'Separate columns with | and put a row of dashes under the header. Columns do not need to line up in the source. Colons in the dash row set alignment.',
    examples: [
      {
        label: 'Table',
        source: '| Platform | Version |\n| --- | --- |\n| Desktop | 2.4.0 |\n| Web | 2.4.0 |\n| Android | 2.3.9 |',
      },
      {
        label: 'Aligned columns',
        source: '| Feature | Status | Votes |\n| :--- | :---: | ---: |\n| Car mode | Planned | 312 |\n| Widgets | **In progress** | 198 |',
        note: ':--- left, :---: center, ---: right.',
      },
    ],
  },
  {
    id: 'dividers',
    title: 'Dividers',
    intro: 'Three dashes on their own line draw a horizontal rule. Leave a blank line above it, or the text above becomes a heading.',
    examples: [
      { label: 'Divider', source: 'Part one.\n\n---\n\nPart two.' },
    ],
  },
  {
    id: 'escaping',
    title: 'Showing symbols literally',
    intro: 'Put a backslash before a symbol to stop it from formatting. HTML tags are removed from posts, so use Markdown instead.',
    examples: [
      { label: 'Escaped symbols', source: 'Use \\*stars\\* and \\_underscores\\_ without styling.' },
      { label: 'Literal # at line start', source: '\\#1 most played this week' },
      { label: 'Number that isn\'t a list', source: '2024\\. What a year.' },
    ],
  },
]

const FULL_EXAMPLE = `Version **2.4** is rolling out today on desktop and web. Here's what's new.

## Highlights

- **Lyrics view**: synced lyrics for thousands of songs
- **Sleep timer**: stop playback after a set time
- _Faster_ search that updates as you type

![New lyrics view](https://picsum.photos/seed/lyrics/640/260)

## Bug fixes

1. Playback no longer skips after a long pause
2. Fixed ~~duplicate~~ songs in shuffle
3. Covers load correctly offline

## Availability

| Platform | Version | Status |
| --- | :---: | --- |
| Desktop | 2.4.0 | Available |
| Web | 2.4.0 | Available |
| Android | 2.4.0 | Next week |

## Coming next

- [x] Lyrics view
- [ ] Car mode
- [ ] Home-screen widgets

> **Tip:** press \`Ctrl + K\` anywhere to open search.

---

Questions or feedback? Read the [full changelog](https://example.com/changelog) or [email us](mailto:team@example.com).`

function ExampleCard({ ex, onInsert }: { ex: Example; onInsert: (text: string) => void }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    navigator.clipboard?.writeText(ex.source).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }
  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--surface-raised)] border-b border-[var(--border)]">
        <span className="text-[11px] font-semibold text-text-secondary">{ex.label}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={copy}
            title="Copy"
            className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
          >
            {copied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
          </button>
          <button
            onClick={() => onInsert(ex.source)}
            title="Insert into the post body"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
          >
            <Plus size={12} /> Insert
          </button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 md:divide-x divide-[var(--border)]">
        <div className="min-w-0 px-3 py-2">
          <span className="block text-[9px] uppercase tracking-wider text-text-muted/70 mb-1">You type</span>
          <pre className="font-mono text-[11.5px] text-text-primary whitespace-pre-wrap break-words leading-relaxed">{ex.source}</pre>
        </div>
        <div className="min-w-0 px-3 py-2 border-t md:border-t-0 border-[var(--border)]">
          <span className="block text-[9px] uppercase tracking-wider text-text-muted/70 mb-1">Readers see</span>
          <Markdown>{ex.source}</Markdown>
        </div>
      </div>
      {ex.note && (
        <p className="px-3 py-1.5 text-[11px] text-text-muted border-t border-[var(--border)]">{ex.note}</p>
      )}
    </div>
  )
}

interface Props {
  onBack: () => void
  // Inserts the snippet into the body at the remembered cursor position.
  onInsert: (text: string) => void
  // Replaces the whole body with the snippet (for the full-post template).
  onUseTemplate: (text: string) => void
  bodyIsEmpty: boolean
}

export default function NewsFormattingHelp({ onBack, onInsert, onUseTemplate, bodyIsEmpty }: Props): JSX.Element {
  const [showFull, setShowFull] = useState(false)
  const jump = (id: string): void => {
    document.getElementById(`news-fmt-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={14} /> Back to post
        </button>
      </div>

      <div>
        <h3 className="text-text-primary text-sm font-semibold">Formatting guide</h3>
        <p className="text-xs text-text-muted mt-1 leading-relaxed">
          The post body uses Markdown: plain text with a few symbols for styling. Each example shows what you
          type and how it appears once published. Use <span className="text-accent font-medium">Insert</span> to
          add an example at your cursor, then edit it. Switch the body to <span className="font-medium">Preview</span> any
          time to check your post.
        </p>
      </div>

      {/* Quick reference */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[var(--surface-raised)]">
            <tr>
              <th className="text-left px-3 py-1.5 text-text-muted font-semibold">For</th>
              <th className="text-left px-3 py-1.5 text-text-muted font-semibold">Type</th>
            </tr>
          </thead>
          <tbody className="[&_td]:px-3 [&_td]:py-1 [&_td]:border-t [&_td]:border-[var(--border)] [&_code]:font-mono [&_code]:text-text-primary">
            <tr><td className="text-text-secondary">Bold</td><td><code>**text**</code></td></tr>
            <tr><td className="text-text-secondary">Italic</td><td><code>_text_</code></td></tr>
            <tr><td className="text-text-secondary">Strikethrough</td><td><code>~~text~~</code></td></tr>
            <tr><td className="text-text-secondary">Heading</td><td><code>## Heading</code></td></tr>
            <tr><td className="text-text-secondary">Link</td><td><code>[text](https://…)</code></td></tr>
            <tr><td className="text-text-secondary">Image</td><td><code>![description](https://…)</code></td></tr>
            <tr><td className="text-text-secondary">Bullet list</td><td><code>- item</code></td></tr>
            <tr><td className="text-text-secondary">Numbered list</td><td><code>1. item</code></td></tr>
            <tr><td className="text-text-secondary">Checklist</td><td><code>- [x] done</code> / <code>- [ ] todo</code></td></tr>
            <tr><td className="text-text-secondary">Quote</td><td><code>&gt; text</code></td></tr>
            <tr><td className="text-text-secondary">Inline code</td><td><code>`code`</code></td></tr>
            <tr><td className="text-text-secondary">Code block</td><td><code>```</code> on lines before and after</td></tr>
            <tr><td className="text-text-secondary">Divider</td><td><code>---</code></td></tr>
            <tr><td className="text-text-secondary">New paragraph</td><td>Blank line</td></tr>
          </tbody>
        </table>
      </div>

      {/* Section jump links */}
      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            className="px-2 py-1 rounded-md border border-[var(--border)] text-[11px] text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
          >
            {s.title}
          </button>
        ))}
        <button
          onClick={() => jump('full')}
          className="px-2 py-1 rounded-md border border-accent/40 text-[11px] text-accent hover:bg-accent/10 transition-colors"
        >
          Full example post
        </button>
      </div>

      {SECTIONS.map((s) => (
        <section key={s.id} id={`news-fmt-${s.id}`} className="space-y-2 scroll-mt-2">
          <h4 className="text-text-primary text-xs font-semibold uppercase tracking-wide">{s.title}</h4>
          {s.intro && <p className="text-xs text-text-muted leading-relaxed">{s.intro}</p>}
          {s.examples.map((ex) => <ExampleCard key={ex.label} ex={ex} onInsert={onInsert} />)}
        </section>
      ))}

      {/* Full post */}
      <section id="news-fmt-full" className="space-y-2 scroll-mt-2">
        <h4 className="text-text-primary text-xs font-semibold uppercase tracking-wide">Full example post</h4>
        <p className="text-xs text-text-muted leading-relaxed">
          A complete update post using most of the above. Start from it and replace the details with your own.
        </p>
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--surface-raised)] border-b border-[var(--border)]">
            <div className="flex rounded-md overflow-hidden border border-[var(--border)]">
              {(['rendered', 'source'] as const).map((mode) => {
                const active = (mode === 'source') === showFull
                return (
                  <button
                    key={mode}
                    onClick={() => setShowFull(mode === 'source')}
                    className={`px-2 py-0.5 text-[11px] font-medium capitalize transition-colors ${active ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-primary'}`}
                  >
                    {mode}
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => {
                if (bodyIsEmpty || window.confirm('Replace the current post body with this template?')) onUseTemplate(FULL_EXAMPLE)
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <Plus size={12} /> Use as template
            </button>
          </div>
          <div className="px-3 py-3">
            {showFull
              ? <pre className="font-mono text-[11.5px] text-text-primary whitespace-pre-wrap break-words leading-relaxed">{FULL_EXAMPLE}</pre>
              : <Markdown>{FULL_EXAMPLE}</Markdown>}
          </div>
        </div>
      </section>

      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={14} /> Back to post
      </button>
    </div>
  )
}
