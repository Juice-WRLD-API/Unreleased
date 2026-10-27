/**
 * Recognition only needs audio in the main app frame. File origins are opaque,
 * so compare the actual packaged document rather than trusting every file URL.
 * mainUrl is the document the main window loaded (did-navigate), not getURL():
 * the router's pushState turns the frame URL into file:///C:/tracker, so the
 * frame only has to stay on file: while its document must be the app bundle.
 * @param {{ url: string, mainUrl: string, appUrl: string, isDev: boolean,
 * isMainWindow: boolean, isMainFrame: boolean }} request
 */
function isAppMainFrame(request) {
  if (!request.isMainWindow || !request.isMainFrame) return false
  try {
    const frame = new URL(request.url)
    const top = new URL(request.mainUrl)
    if (request.isDev) return frame.origin === 'http://localhost:3018' && top.origin === frame.origin
    const app = new URL(request.appUrl)
    return frame.protocol === 'file:' && frame.host === app.host
      && top.protocol === 'file:' && top.host === app.host && top.pathname === app.pathname
  } catch { return false }
}

/**
 * @param {{ url: string, mainUrl: string, appUrl: string, isDev: boolean,
 * isMainWindow: boolean, isMainFrame: boolean, mediaTypes: string[] }} request
 */
function canRequestMicrophone(request) {
  return request.mediaTypes.length === 1 && request.mediaTypes[0] === 'audio' && isAppMainFrame(request)
}

/**
 * Device-audio recognition: getDisplayMedia from the main app frame, asking for
 * audio, on Windows (the only platform with Electron loopback capture). The
 * video it must also request is a 1px screen track the renderer drops at once.
 * @param {{ url: string, mainUrl: string, appUrl: string, isDev: boolean,
 * isMainWindow: boolean, isMainFrame: boolean, audioRequested: boolean, platform: string }} request
 */
function canCaptureSystemAudio(request) {
  return request.platform === 'win32' && request.audioRequested && isAppMainFrame(request)
}

module.exports = { canRequestMicrophone, canCaptureSystemAudio }
