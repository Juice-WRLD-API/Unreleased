declare module 'jsmediatags/dist/jsmediatags.min.js' {
  interface Picture { format: string; data: number[] }
  interface Tags {
    title?: string
    artist?: string
    album?: string
    year?: string
    genre?: string
    picture?: Picture
  }
  const jsmediatags: {
    read(
      file: Blob | string,
      cb: { onSuccess: (r: { tags: Tags }) => void; onError: (e: { type: string; info: string }) => void },
    ): void
  }
  export default jsmediatags
}
