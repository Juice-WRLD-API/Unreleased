import { saveFile, reportSaveError } from '../fileSave'
// A file from this computer, for commands that upload (an avatar, a cover).
// The terminal has no drag-and-drop, so it opens the same system picker the UI
// does. Browsers only allow that straight after a keypress, which is exactly
// when a command is run, so call this first thing in the command.
export function pickLocalFile(accept: string): Promise<File> {
  return new Promise<File>((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    const done = (): void => { input.remove() }
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      done()
      if (file) resolve(file)
      else reject(new Error('cancelled'))
    })
    input.addEventListener('cancel', () => { done(); reject(new Error('cancelled')) })
    document.body.appendChild(input)
    input.click()
  })
}

/** Hands bytes to the browser's download, under the given name. */
export function saveBlob(blob: Blob, name: string): void {
  void saveFile(name, blob).catch(reportSaveError)
}
