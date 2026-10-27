# The install stand-in (see showInstallStandIn in ../main.js). The installer
# replaces the app's own files, so the app quits before it runs and takes the
# updating window with it. This window takes its place: a capture of the
# updating window at the same spot, with the progress sweep drawn live over the
# captured bar, so the whole update reads as one window. It closes when the new
# version deletes the hold file, or by itself once the installer has been gone
# for a while. Windows PowerShell 5.1 and WPF, both part of Windows.
param([Parameter(Mandatory = $true)][string]$Config)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json
$runDir = Split-Path -Parent $Config

# Anything that goes wrong just ends the stand-in. Before it's up, the app
# notices (no ready file) and shows the installer's own window instead.
trap {
  Remove-Item -LiteralPath $runDir -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

Add-Type -Namespace UnreleasedUpdate -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
'@

# DPI aware, so the capture shows pixel for pixel instead of being stretched.
# System aware is exact on the main display, which is where the app opens.
try { $null = [UnreleasedUpdate.Native]::SetProcessDpiAwarenessContext([IntPtr]::new(-2)) }
catch { $null = [UnreleasedUpdate.Native]::SetProcessDPIAware() }

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing

# The app gave up waiting and ran the installer with its own window.
if (-not (Test-Path -LiteralPath $cfg.hold)) {
  Remove-Item -LiteralPath $runDir -Recurse -Force -ErrorAction SilentlyContinue
  exit
}

# Everything in the config is in physical pixels; WPF works in units of 1/96 in.
$screen = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
$scale = $screen.DpiX / 96
$screen.Dispose()
function Dip([double]$px) { $px / $scale }
function Brush([string]$hex) {
  $brush = [System.Windows.Media.BrushConverter]::new().ConvertFromString($hex)
  $brush.Freeze()
  $brush
}

$width = Dip $cfg.width
$height = Dip $cfg.height

$capture = [System.Windows.Media.Imaging.BitmapImage]::new()
$capture.BeginInit()
$capture.CacheOption = 'OnLoad'
$capture.UriSource = [Uri]::new($cfg.image)
$capture.EndInit()
$capture.Freeze()

$image = [System.Windows.Controls.Image]::new()
$image.Source = $capture
$image.Stretch = 'Fill'
$image.Width = $width
$image.Height = $height
$image.HorizontalAlignment = 'Left'
$image.VerticalAlignment = 'Top'
[System.Windows.Media.RenderOptions]::SetBitmapScalingMode($image, 'HighQuality')

# The bar, drawn over the captured one (and its frozen sweep).
$barWidth = Dip $cfg.bar.width
$barHeight = Dip $cfg.bar.height
$radius = Dip $cfg.bar.radius
$bar = [System.Windows.Controls.Canvas]::new()
$bar.Width = $barWidth
$bar.Height = $barHeight
$bar.Background = Brush $cfg.colors.track
$bar.Clip = [System.Windows.Media.RectangleGeometry]::new([System.Windows.Rect]::new(0, 0, $barWidth, $barHeight), $radius, $radius)
[System.Windows.Controls.Canvas]::SetLeft($bar, (Dip $cfg.bar.x))
[System.Windows.Controls.Canvas]::SetTop($bar, (Dip $cfg.bar.y))

$sweep = [System.Windows.Shapes.Rectangle]::new()
$sweep.Height = $barHeight
$sweep.Fill = Brush $cfg.colors.accent
$sweep.RadiusX = $radius
$sweep.RadiusY = $radius
if ($cfg.sweep.reducedMotion) {
  # updating.css's reduced-motion bar: full width, faint, still.
  $sweep.Width = $barWidth
  $sweep.Opacity = 0.35
} else {
  $sweep.Width = Dip $cfg.sweep.width
  $move = [System.Windows.Media.TranslateTransform]::new(-$sweep.Width, 0)
  $sweep.RenderTransform = $move
}
$null = $bar.Children.Add($sweep)

# Background under the bar, so the captured bar can't show at its rounded corners.
$patch = [System.Windows.Shapes.Rectangle]::new()
$patch.Width = $barWidth
$patch.Height = $barHeight
$patch.Fill = Brush $cfg.colors.background
[System.Windows.Controls.Canvas]::SetLeft($patch, (Dip $cfg.bar.x))
[System.Windows.Controls.Canvas]::SetTop($patch, (Dip $cfg.bar.y))

$overlay = [System.Windows.Controls.Canvas]::new()
$null = $overlay.Children.Add($patch)
$null = $overlay.Children.Add($bar)
$root = [System.Windows.Controls.Grid]::new()
$null = $root.Children.Add($image)
$null = $root.Children.Add($overlay)

# updating.css's sweep: from -100% to 250% of its own width every period, on
# cubic-bezier(0.4, 0, 0.2, 1). It carries on from where the page's sweep was,
# so the swap doesn't jump.
function Start-Sweep {
  if ($cfg.sweep.reducedMotion) { return }
  $period = [double]$cfg.sweep.period
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $phase = ([double]$cfg.sweep.phase + ($now - [double]$cfg.sweep.at)) % $period
  if ($phase -lt 0) { $phase += $period }

  $anim = [System.Windows.Media.Animation.DoubleAnimationUsingKeyFrames]::new()
  $start = [System.Windows.Media.Animation.KeyTime]::FromTimeSpan([TimeSpan]::Zero)
  $end = [System.Windows.Media.Animation.KeyTime]::FromTimeSpan([TimeSpan]::FromMilliseconds($period))
  $curve = [System.Windows.Media.Animation.KeySpline]::new(0.4, 0, 0.2, 1)
  $null = $anim.KeyFrames.Add([System.Windows.Media.Animation.DiscreteDoubleKeyFrame]::new(-$sweep.Width, $start))
  $null = $anim.KeyFrames.Add([System.Windows.Media.Animation.SplineDoubleKeyFrame]::new(2.5 * $sweep.Width, $end, $curve))
  $anim.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds($period))
  $anim.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
  # A negative start time runs it as if it had begun that long ago.
  $anim.BeginTime = [TimeSpan]::FromMilliseconds(-$phase)
  $move.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $anim)
}

$window = [System.Windows.Window]::new()
$window.Title = 'Unreleased'
$window.WindowStyle = 'None'
$window.ResizeMode = 'NoResize'
$window.ShowInTaskbar = $false
$window.WindowStartupLocation = 'Manual'
$window.Left = Dip $cfg.x
$window.Top = Dip $cfg.y
$window.Width = $width
$window.Height = $height
$window.Background = Brush $cfg.colors.background
$window.UseLayoutRounding = $true
$window.Content = $root

# Frameless app windows get Windows 11's rounded corners; ask for the same.
# Before Windows 11 the call fails and neither window is rounded.
$window.Add_SourceInitialized({
  $handle = [System.Windows.Interop.WindowInteropHelper]::new($window).Handle
  $round = 2
  $null = [UnreleasedUpdate.Native]::DwmSetWindowAttribute($handle, 33, [ref]$round, 4)
})
# Movable like the updating window, whose whole body is a drag handle.
$window.Add_MouseLeftButtonDown({ try { $window.DragMove() } catch {} })
$window.Add_Loaded({ Start-Sweep })
# On screen: the app can quit now.
$window.Add_ContentRendered({ [System.IO.File]::WriteAllText($cfg.ready, '') })

function Stop-StandIn {
  Remove-Item -LiteralPath $cfg.hold -Force -ErrorAction SilentlyContinue
  $window.Close()
}

$script:clock = [System.Diagnostics.Stopwatch]::StartNew()
$script:appGone = $false
$script:quietSince = $null
$watch = [System.Windows.Threading.DispatcherTimer]::new()
$watch.Interval = [TimeSpan]::FromMilliseconds(250)
$watch.Add_Tick({
  try {
    # The new version is on screen, or the app took the install back.
    if (-not (Test-Path -LiteralPath $cfg.hold)) { $window.Close(); return }
    $elapsed = $script:clock.Elapsed.TotalSeconds
    if ($elapsed -gt $cfg.limits.maxSeconds) { Stop-StandIn; return }
    if (-not $script:appGone) {
      $script:appGone = -not (Get-Process -Id $cfg.appPid -ErrorAction SilentlyContinue)
      return
    }
    if ($cfg.installer -and [System.Diagnostics.Process]::GetProcessesByName($cfg.installer).Length -gt 0) {
      $script:quietSince = $null
      return
    }
    # The installer is done (or never showed): the new version should open any
    # moment. If it doesn't, the install didn't take; stop standing in.
    if ($null -eq $script:quietSince) { $script:quietSince = $elapsed }
    if ($elapsed - $script:quietSince -gt $cfg.limits.reopenSeconds) { Stop-StandIn }
  } catch {
    Stop-StandIn
  }
})
$window.Add_Closed({ $watch.Stop() })
$watch.Start()

$null = $window.ShowDialog()
Remove-Item -LiteralPath $runDir -Recurse -Force -ErrorAction SilentlyContinue
