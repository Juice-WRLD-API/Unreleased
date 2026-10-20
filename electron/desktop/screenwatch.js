// Which window is in front, told when it changes: for the light shown only on the desktop, and for the desk cleared,
// which comes back when the user goes to another app. A small PowerShell helper asks Windows five times a second -
// started only while something needs it, and gone by itself should Unreleased stop without saying so. The script is
// handed over encoded on its command line, so nothing needs to sit outside the app's archive.
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
  '}',
  '"@',
  // The app's own process: the helper ends itself once it's gone. Written in before the script is encoded - trailing
  // arguments aren't handed to an encoded command.
  '$parent = __PARENT__',
  "$last = ''",
  '$checked = [DateTime]::Now',
  'while ($true) {',
  '  $h = [UnreleasedFront]::GetForegroundWindow()',
  '  $owner = [uint32]0',
  '  [void][UnreleasedFront]::GetWindowThreadProcessId($h, [ref]$owner)',
  '  $name = New-Object System.Text.StringBuilder 256',
  '  [void][UnreleasedFront]::GetClassName($h, $name, 256)',
  '  $line = [string]$owner + [char]9 + $name.ToString()',
  '  if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }',
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

class ScreenWatch extends EventEmitter {
  constructor() {
    super()
    /** @type {import('child_process').ChildProcess | null} */
    this.child = null
    this.wanted = new Set()
    /** @type {{ pid: number, className: string } | null} the window in front, once told */
    this.front = null
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
        const [pid, className = ''] = line.split('\t')
        this.front = { pid: Number(pid) || 0, className: className.trim() }
        this.emit('front', this.front)
      })
    }
    child.on('error', () => {})
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.front = null
      // Gone while still wanted (killed from outside): started again a moment later.
      if (this.wanted.size) setTimeout(() => { if (this.wanted.size && !this.child) this.start() }, 3000)
    })
  }

  stop() {
    const child = this.child
    this.child = null
    this.front = null
    try { child?.kill() } catch { /* already gone */ }
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

module.exports = { screenWatch: new ScreenWatch(), ScreenWatch, DESKTOP_CLASSES, PASSING_CLASSES, SCRIPT }
