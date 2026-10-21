// Which window is in front, and where the apps' windows are, told when it changes: for the light shown only on the
// desktop, and for the desk cleared, which covers only the displays no app is on and comes back when the user goes to
// an app under it. A small PowerShell helper asks Windows five times a second - started only while something needs
// it, and gone by itself should Unreleased stop without saying so. The script is handed over encoded on its command
// line, so nothing needs to sit outside the app's archive.
const { spawn } = require('child_process')
const EventEmitter = require('events')
const readline = require('readline')

const SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  'Add-Type @"',
  'using System; using System.Runtime.InteropServices; using System.Text;',
  'public static class UnreleasedFront {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint owner);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr c);',
  '  delegate bool EachWindow(IntPtr h, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool EnumWindows(EachWindow f, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);',
  '  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);',
  '  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);',
  '  [StructLayout(LayoutKind.Sequential)] struct Rect { public int L, T, R, B; }',
  '  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int what, out Rect r, int size);',
  '  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int what, out int v, int size);',
  // Where the window is drawn (its frame, without the invisible borders a maximized window reaches the next display with).
  '  public static string Bounds(IntPtr h) {',
  '    Rect r;',
  '    if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) return "";',
  '    return r.L + "," + r.T + "," + r.R + "," + r.B;',
  '  }',
  // The apps' windows on screen, as Alt+Tab has them: shown, not minimized, not on another virtual desktop (cloaked),
  // not a tool window or an owned one, not one that takes no clicks or never comes forward. "pid,l,t,r,b,class;" each.
  '  public static string Windows() {',
  '    var all = new StringBuilder();',
  '    EnumWindows((h, l) => {',
  '      if (!IsWindowVisible(h) || IsIconic(h)) return true;',
  '      int ex = GetWindowLong(h, -20);',
  '      if ((ex & 0x40000) == 0 && ((ex & 0x80) != 0 || GetWindow(h, 4) != IntPtr.Zero)) return true;',
  '      if ((ex & 0x08000020) != 0) return true;',
  '      int cloaked;',
  '      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;',
  '      string bounds = Bounds(h);',
  '      if (bounds == "") return true;',
  '      uint owner;',
  '      GetWindowThreadProcessId(h, out owner);',
  '      var name = new StringBuilder(256);',
  '      GetClassName(h, name, 256);',
  '      all.Append(owner).Append(",").Append(bounds).Append(",").Append(name).Append(";");',
  '      return true;',
  '    }, IntPtr.Zero);',
  '    return all.ToString();',
  '  }',
  '}',
  '"@',
  // The app's own process: the helper ends itself once it's gone. Written in before the script is encoded - trailing
  // arguments aren't handed to an encoded command.
  '$parent = __PARENT__',
  // Real pixels, however each display is scaled: Electron's screen turns them into its own.
  '[void][UnreleasedFront]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))',
  "$last = ''",
  "$lastWindows = ''",
  '$checked = [DateTime]::Now',
  'while ($true) {',
  '  $h = [UnreleasedFront]::GetForegroundWindow()',
  '  $owner = [uint32]0',
  '  [void][UnreleasedFront]::GetWindowThreadProcessId($h, [ref]$owner)',
  '  $name = New-Object System.Text.StringBuilder 256',
  '  [void][UnreleasedFront]::GetClassName($h, $name, 256)',
  '  $line = "front" + [char]9 + [string]$owner + [char]9 + $name.ToString() + [char]9 + [UnreleasedFront]::Bounds($h)',
  '  if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }',
  '  $windows = [UnreleasedFront]::Windows()',
  '  if ($windows -ne $lastWindows) { $lastWindows = $windows; [Console]::Out.WriteLine("windows" + [char]9 + $windows); [Console]::Out.Flush() }',
  '  if (([DateTime]::Now - $checked).TotalSeconds -ge 2) {',
  '    $checked = [DateTime]::Now',
  '    if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }',
  '  }',
  '  Start-Sleep -Milliseconds 200',
  '}',
].join('\r\n')

/** The desktop itself in front. */
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW'])
/** On the way somewhere: the taskbar, the Start menu, Alt+Tab, the notification area. */
const PASSING_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame', 'TaskSwitcherWnd', 'ForegroundStaging', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland'])

/** "l,t,r,b" in real pixels as a rectangle; null for anything else. */
function rectOf(text) {
  const [l, t, r, b] = String(text || '').split(',').map(Number)
  if (![l, t, r, b].every(Number.isFinite) || r <= l || b <= t) return null
  return { x: l, y: t, width: r - l, height: b - t }
}

/** The helper's "pid,l,t,r,b,class;" list: every app window on screen, where it is in real pixels. */
function parseWindows(text) {
  const windows = []
  for (const one of String(text || '').split(';')) {
    const [pid, l, t, r, b, ...name] = one.split(',')
    const rect = rectOf([l, t, r, b].join(','))
    if (rect) windows.push({ pid: Number(pid) || 0, className: name.join(','), rect })
  }
  return windows
}

class ScreenWatch extends EventEmitter {
  constructor() {
    super()
    /** @type {import('child_process').ChildProcess | null} */
    this.child = null
    this.wanted = new Set()
    /** @type {{ pid: number, className: string, rect?: { x: number, y: number, width: number, height: number } | null } | null}
     *  the window in front, once told */
    this.front = null
    /** @type {{ pid: number, className: string, rect: { x: number, y: number, width: number, height: number } }[] | null}
     *  the apps' windows on screen, once told */
    this.windows = null
  }

  /** `who` needs to know (or no longer does); the helper runs while anyone does. */
  need(who, on) {
    if (on) this.wanted.add(who); else this.wanted.delete(who)
    if (this.wanted.size && !this.child) this.start()
    else if (!this.wanted.size && this.child) this.stop()
  }

  start() {
    if (process.platform !== 'win32') return
    const encoded = Buffer.from(SCRIPT.replace('__PARENT__', String(process.pid)), 'utf16le').toString('base64')
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-EncodedCommand', encoded], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (error) {
      console.warn('[desktop] screen watch failed to start:', error.message)
      return
    }
    this.child = child
    if (child.stdout) {
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        const [kind, ...rest] = line.split('\t')
        if (kind === 'windows') {
          this.windows = parseWindows(rest[0])
          this.emit('windows', this.windows)
        } else if (kind === 'front') {
          const [pid, className = '', bounds] = rest
          this.front = { pid: Number(pid) || 0, className: className.trim(), rect: rectOf(bounds) }
          this.emit('front', this.front)
        }
      })
    }
    child.on('error', () => {})
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.front = null
      this.windows = null
      // Gone while still wanted (killed from outside): started again a moment later.
      if (this.wanted.size) setTimeout(() => { if (this.wanted.size && !this.child) this.start() }, 3000)
    })
  }

  stop() {
    const child = this.child
    this.child = null
    this.front = null
    this.windows = null
    try { child?.kill() } catch { /* already gone */ }
  }

  /** The apps' windows on screen: at once when known, else as soon as the helper tells them - null should it not
   *  within `waitMs` (not on Windows, or the helper not starting). */
  windowsSoon(waitMs) {
    if (this.windows) return Promise.resolve(this.windows)
    return new Promise((resolve) => {
      const done = (windows) => { clearTimeout(timer); this.off('windows', done); resolve(windows) }
      const timer = setTimeout(() => done(null), waitMs)
      this.on('windows', done)
    })
  }

  /** Whether the desktop, or one of Unreleased's own windows, is in front - or nothing has been told yet. */
  desktopInFront() {
    const f = this.front
    if (!f) return true
    return f.pid === process.pid || DESKTOP_CLASSES.has(f.className) || PASSING_CLASSES.has(f.className)
  }

  /** Whether `front` is another app's own window (not ours, not the desktop, not the shell on the way somewhere). */
  static isOtherApp(front) {
    return Boolean(front) && front.pid !== process.pid && !DESKTOP_CLASSES.has(front.className) && !PASSING_CLASSES.has(front.className)
  }
}

module.exports = { screenWatch: new ScreenWatch(), ScreenWatch, DESKTOP_CLASSES, PASSING_CLASSES, SCRIPT, parseWindows }
