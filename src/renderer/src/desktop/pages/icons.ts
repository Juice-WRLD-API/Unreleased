// The desktop player's symbols, drawn after the SF Symbols the Mac player uses, as SVG on a 24-unit grid (iJWA's).
const svg = (body: string, { fill = 'currentColor', stroke = 'none', width = 0 }: { fill?: string; stroke?: string; width?: number } = {}): string =>
  `<svg viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const line = (body: string, width = 2): string => svg(body, { fill: 'none', stroke: 'currentColor', width })

export const icons: Record<string, string> = {
  play: svg('<path d="M7 4.6c0-1.1 1.2-1.8 2.2-1.2l11 6.9c.9.6.9 1.9 0 2.5l-11 6.9C8.2 20.3 7 19.6 7 18.5z"/>'),
  pause: svg('<rect x="5.5" y="3.5" width="4.6" height="17" rx="1.4"/><rect x="13.9" y="3.5" width="4.6" height="17" rx="1.4"/>'),
  backward: svg('<path d="M11.4 6.2c0-.9-1-1.4-1.7-.9L1.9 11.1c-.6.4-.6 1.3 0 1.8l7.8 5.8c.7.5 1.7 0 1.7-.9z"/><path d="M22.6 6.2c0-.9-1-1.4-1.7-.9l-7.8 5.8c-.6.4-.6 1.3 0 1.8l7.8 5.8c.7.5 1.7 0 1.7-.9z"/>'),
  forward: svg('<path d="M12.6 6.2c0-.9 1-1.4 1.7-.9l7.8 5.8c.6.4.6 1.3 0 1.8l-7.8 5.8c-.7.5-1.7 0-1.7-.9z"/><path d="M1.4 6.2c0-.9 1-1.4 1.7-.9l7.8 5.8c.6.4.6 1.3 0 1.8l-7.8 5.8c-.7.5-1.7 0-1.7-.9z"/>'),
  repeat: line('<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="M16 3l3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="M8 21l-3-3 3-3"/>'),
  repeatOne: line('<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="M16 3l3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="M8 21l-3-3 3-3"/><path d="M11.2 10.6 12.6 9.6v5" stroke-width="1.7"/>'),
  lyrics: line('<path d="M5.5 4h13A2.5 2.5 0 0 1 21 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17h-1A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4z"/><path d="M8.6 9.2c-.5.5-.8 1.2-.8 2.1M12.4 9.2c-.5.5-.8 1.2-.8 2.1" stroke-width="2.2"/>', 1.8),
  // SF Symbols' moon.fill: the desk cleared, as Focus clears a Mac or an iPhone.
  moon: svg('<path d="M14.6 2.6a.8.8 0 0 0-1 1A8.2 8.2 0 0 1 4.6 13.6a.8.8 0 0 0-1 1A9.6 9.6 0 1 0 14.6 2.6z"/>'),
  list: svg('<circle cx="4.5" cy="6" r="1.6"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="4.5" cy="18" r="1.6"/><rect x="8.5" y="5" width="12.5" height="2" rx="1"/><rect x="8.5" y="11" width="12.5" height="2" rx="1"/><rect x="8.5" y="17" width="12.5" height="2" rx="1"/>'),
  speaker0: svg('<path d="M3.5 9.2h3.2L11.3 5c.6-.5 1.5-.1 1.5.7v12.6c0 .8-.9 1.2-1.5.7l-4.6-4.2H3.5c-.6 0-1-.4-1-1V10.2c0-.6.4-1 1-1z"/><path d="m16 9.5 5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  speaker1: svg('<path d="M3.5 9.2h3.2L11.3 5c.6-.5 1.5-.1 1.5.7v12.6c0 .8-.9 1.2-1.5.7l-4.6-4.2H3.5c-.6 0-1-.4-1-1V10.2c0-.6.4-1 1-1z"/><path d="M15.8 9.3a4 4 0 0 1 0 5.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  speaker2: svg('<path d="M3.5 9.2h3.2L11.3 5c.6-.5 1.5-.1 1.5.7v12.6c0 .8-.9 1.2-1.5.7l-4.6-4.2H3.5c-.6 0-1-.4-1-1V10.2c0-.6.4-1 1-1z"/><path d="M15.8 9.3a4 4 0 0 1 0 5.4M18.4 6.8a7.6 7.6 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  heart: line('<path d="M12 20.3S3.5 15.2 3.5 9.1A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.5c0 6.1-8.5 11.2-8.5 11.2z"/>', 1.9),
  heartFill: svg('<path d="M12 20.3S3.5 15.2 3.5 9.1A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.5c0 6.1-8.5 11.2-8.5 11.2z"/>'),
  ellipsis: svg('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
  playSmall: svg('<path d="M8 5.2c0-.9 1-1.4 1.7-.9l9.4 6c.7.4.7 1.4 0 1.9l-9.4 6c-.7.4-1.7-.1-1.7-.9z"/>'),
  clear: svg('<circle cx="12" cy="12" r="9.5"/><path d="m8.8 8.8 6.4 6.4M15.2 8.8l-6.4 6.4" stroke="#1d1d22" stroke-width="2" stroke-linecap="round"/>'),
  search: line('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>', 2.2),
  livePhoto: line('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.2" stroke-dasharray="1.2 2.4"/><circle cx="12" cy="12" r="9.3"/>', 1.6),
  livePhotoOff: line('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.2" stroke-dasharray="1.2 2.4"/><circle cx="12" cy="12" r="9.3"/><path d="M3.5 3.5l17 17"/>', 1.6),
  gear: line('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 1.8),
  mini: line('<path d="M20 4l-6 6M14 5.5V10h4.5M4 20l6-6M10 18.5V14H5.5"/>', 2),
  expand: line('<path d="M14 10l6-6M15.5 4H20v4.5M10 14l-6 6M8.5 20H4v-4.5"/>', 2),
  arrowOut: line('<path d="M8 16 16 8M9.5 8H16v6.5"/>', 2.4),
  note: svg('<path d="M9 17.5V6.3c0-.6.4-1.1 1-1.2l8.5-1.8c.8-.2 1.5.4 1.5 1.2v10.6" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="6.6" cy="17.6" rx="2.9" ry="2.4"/><ellipse cx="17.6" cy="15.3" rx="2.9" ry="2.4"/>'),
  download: line('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>', 2),
  waveform: svg('<rect x="3" y="9" width="2.2" height="6" rx="1.1"/><rect x="7.2" y="5" width="2.2" height="14" rx="1.1"/><rect x="11.4" y="2.5" width="2.2" height="19" rx="1.1"/><rect x="15.6" y="6.5" width="2.2" height="11" rx="1.1"/><rect x="19.8" y="9.5" width="2.2" height="5" rx="1.1"/>'),
  eye: line('<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', 1.9),
  eyeSlash: line('<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>', 1.9),
  tick: line('<path d="M4.5 12.5l5 5L19.5 7"/>', 3),
  puzzle: svg('<path d="M10 4.6a2.1 2.1 0 1 1 4 0V6h3.4c.9 0 1.6.7 1.6 1.6V11h-1.4a2.1 2.1 0 1 0 0 4H19v3.4c0 .9-.7 1.6-1.6 1.6H14v-1.4a2.1 2.1 0 1 0-4 0V20H6.6c-.9 0-1.6-.7-1.6-1.6V15h1.4a2.1 2.1 0 1 0 0-4H5V7.6C5 6.7 5.7 6 6.6 6H10z"/>'),
  stack: line('<rect x="4" y="8" width="16" height="12" rx="2.5"/><path d="M6.5 5h11M9 2.5h6"/>', 1.5),
}
