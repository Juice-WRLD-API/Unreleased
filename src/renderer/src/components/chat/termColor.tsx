import { Fragment, type ReactNode } from 'react'

// Colour for the terminal's structured output. Commands print plain text, so
// this works from the shape of a line (a number column, a size, a "key: value",
// a tree branch ...) and paints the parts that mean something. It returns null
// for a line it has no opinion on, and hands every uncoloured stretch to `rest`
// so the caller's link handling (@handles, "→ command" hints) still applies.
// Anything it doesn't recognise is left exactly as it was.

const DIM = 'text-[color:var(--t-dim)]'
const PATH = 'text-[color:var(--t-path)]'
const ACCENT = 'text-[color:var(--t-accent)]'
const OK = 'text-[color:var(--t-ok)]'
const ERR = 'text-[color:var(--t-err)]'
const WARN = 'text-[#e5c07b]'
const USER = 'text-[color:var(--t-user)]'

type Rest = (text: string) => ReactNode

const span = (cls: string, text: string, bold = false): ReactNode => <span className={bold ? `${cls} font-semibold` : cls}>{text}</span>
const frag = (...nodes: ReactNode[]): ReactNode => <>{nodes.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>

const ROLE_COLOR: Record<string, string> = { administrator: ERR, editor: PATH, contributor: OK, manager: WARN, applicant: DIM }
const BARS = /[█▇▆▅▄▃▂▁▌▐░▒▓]+/

// Bars, role names (in table rows only) and a trailing shown/hidden.
function inline(text: string, rest: Rest, roles = false): ReactNode {
  const re = new RegExp(`(${BARS.source})|${roles ? '\\b(administrator|editor|contributor|manager|applicant)\\b|' : ''}(?:\\s)(shown|hidden)$`, 'g')
  const out: ReactNode[] = []
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index
    if (m[1]) {
      out.push(rest(text.slice(last, start)), span(ACCENT, m[1]))
      last = start + m[1].length
    } else if (roles && m[2]) {
      out.push(rest(text.slice(last, start)), span(ROLE_COLOR[m[2]] ?? PATH, m[2]))
      last = start + m[2].length
    } else {
      const word = m[roles ? 3 : 2]
      const at = start + 1
      out.push(rest(text.slice(last, at)), span(word === 'shown' ? OK : DIM, word))
      last = at + word.length
    }
  }
  if (out.length === 0) return rest(text)
  out.push(rest(text.slice(last)))
  return frag(...out)
}

const isDir = (name: string): boolean => /\/$/.test(name)
const name = (text: string, rest: Rest): ReactNode => (isDir(text) ? span(PATH, text, true) : rest(text))

export function colorLine(line: string, rest: Rest): ReactNode | null {
  let m: RegExpExecArray | null

  // ── file tree ─────────────────────────────────────────────────────────────
  // wc:   "     12      40     300 name"
  if ((m = /^(\s*\d+\s+\d+\s+\d+)( \S.*)$/.exec(line))) return frag(span(DIM, m[1]), rest(m[2]))
  // du:   "   1.2 MB     3 files  folder/"
  if ((m = /^(\s*[\d.,]+\s?[A-Za-z]{1,3})(\s{2}\s*)(\d+ files?)(\s{2})(.*)$/.exec(line))) {
    return frag(span(OK, m[1]), m[2], span(DIM, m[3]), m[4], name(m[5], rest))
  }
  // ls:   "   1.2 MB  file.txt" / "     <dir>  folder/"
  if ((m = /^(\s*(?:<dir>|-|[\d.,]+\s?(?:B|KB|MB|GB|TB|KiB|MiB|GiB)))(  )(.+)$/.exec(line))) {
    return frag(span(DIM, m[1]), m[2], name(m[3], rest))
  }
  // tree: "│   ├── name/"
  if ((m = /^([│ ]*[├└]── )(.*)$/.exec(line))) return frag(span(DIM, m[1]), name(m[2], rest))
  // grep: "path/file.txt:12: matching line"
  if ((m = /^([^\s:][^:\n]*):(\d+): (.*)$/.exec(line))) return frag(span(PATH, m[1]), span(DIM, `:${m[2]}:`), ' ', rest(m[3]))
  // a bare top-level folder name (ls at the root)
  if (/^\S+\/$/.test(line)) return span(PATH, line, true)

  // ── tables ────────────────────────────────────────────────────────────────
  // review queues: "#123   edit   title  user  3h ago"
  if ((m = /^(#\d+)(\s+)(\S+)(\s+)(.*)$/.exec(line))) return frag(span(ACCENT, m[1], true), m[2], span(PATH, m[3]), m[4], inline(m[5], rest, true))
  // active moderation: "ban     name  until ..."
  if ((m = /^(ban|mute|timeout)(\s+)(.*)$/i.exec(line))) return frag(span(m[1].toLowerCase() === 'ban' ? ERR : WARN, m[1], true), m[2], rest(m[3]))
  // the active row of a list: "* default  Default"
  if ((m = /^(\*) (\S+)(\s+)(.*)$/.exec(line))) return frag(span(ACCENT, m[1], true), ' ', span(PATH, m[2], true), m[3], rest(m[4]))
  // numbered rows: "  3  title", "▶ 12  title", and id tables "1234   name  display  role"
  if ((m = /^(\s*)(▶|\*)?(\s*)(\d+)(\s{2,})(\S.*)$/.exec(line))) {
    return frag(m[1], m[2] ? span(ACCENT, m[2], true) : '', m[3], span(DIM, m[4]), m[5], inline(m[6], rest, true))
  }

  // ── prose-ish output ──────────────────────────────────────────────────────
  // help descriptions and their aliases line, indented under the usage
  if ((m = /^( {6,})(\S.*)$/.exec(line))) return frag(m[1], span(DIM, m[2]))
  // a message log: "Oct 3 10:03 PM  author: text" and its "── room · last 20 ──" header
  if ((m = /^(.{3,8} \d{1,2} [\d:]+ ?(?:[AP]M)?)(  )(.+?): (.*)$/i.exec(line))) return frag(span(DIM, m[1]), m[2], span(USER, m[3], true), ': ', rest(m[4]))
  if (/^── .* ──$/.test(line)) return span(DIM, line)
  // neofetch: logo, then "Key: value" and "user@unreleased"
  if ((m = /^(.*?(?:^|\s\s))(OS|Host|Uptime|Shell|Theme|Resolution|Chat|Library|Playing): (.*)$/.exec(line))) {
    return frag(m[1], span(ACCENT, `${m[2]}:`, true), ' ', rest(m[3]))
  }
  if ((m = /^(.*?)(\S+@unreleased)$/.exec(line))) return frag(m[1], span(USER, m[2], true))
  // a user card: "name (display)   #123"
  if ((m = /^(\S.*?)(\s{3})(#\d+)$/.exec(line))) return frag(span(USER, m[1], true), m[2], span(DIM, m[3]))
  // "key: value" lines (roles:, bio:, listening to: ...)
  if ((m = /^([a-z][a-z ]{1,18}): (.+)$/.exec(line))) return frag(span(PATH, `${m[1]}:`), ' ', rest(m[2]))

  // anything else: bars, and a trailing shown/hidden
  const plain = inline(line, rest)
  return /█|▌|░|\s(?:shown|hidden)$/.test(line) ? plain : null
}
