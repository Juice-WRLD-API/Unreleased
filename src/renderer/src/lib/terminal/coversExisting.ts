// What the terminal commands that predate the `covers` field reach, so
// `npm run terminal:check-coverage` can account for them. Newer commands carry
// their own `covers`; fold these into the commands if they are ever reworked.
// Read by scripts/check-terminal-coverage.mjs (not imported by the app).
export const EXISTING_COVERS: Record<string, string[]> = {
  // admin.ts
  pending: ['userApi.adminProposalCounts', 'userApi.adminCompProposalCounts', 'userApi.adminListApplications'],
  proposals: ['userApi.adminListProposals'],
  approve: ['userApi.adminReviewProposal', 'userApi.adminReviewCompProposal', 'userApi.adminReviewApplication'],
  comps: ['userApi.adminListCompProposals'],
  applications: ['userApi.adminListApplications'],
  reverse: ['userApi.adminReverseProposal', 'userApi.adminReverseCompProposal'],
  users: ['userApi.adminListUsers'],
  inspect: ['userApi.adminGetUser'],
  // users.ts
  user: ['userApi.getPublicProfile', 'userApi.getNowPlaying', 'userApi.adminGetUser'],
  // cdn.ts
  cdn: ['cdnAdminApi.fetchCdnNodes', 'cdnAdminApi.fetchCdnStats', 'cdnAdminApi.updateCdnNode', 'cdnAdminApi.deleteCdnNode'],
  // app.ts
  logout: ['userApi.logout'],
  channel: ['juicewrldApi.fetchChannels'],
  version: ['appVersion.fetchRunningCommit'],
  // library.ts, player.ts, fun.ts, index.ts (lookup)
  song: ['juicewrldApi.getSongById', 'juicewrldApi.getSongsByIds'],
  find: ['juicewrldApi.searchSongs', 'juicewrldApi.resolveTitleToSong'],
  juicesay: ['juicewrldApi.loadAllSongsAbortable'],
  // the raw escape hatch reaches any endpoint by hand
  http: ['juicewrldApi.apiFetch'],
  // comp staging download goes through this helper
  comp: ['userApi.fetchAuthedBlob'],
}

// Chat slash commands run in the terminal through the composer's runner (see
// chatTerminalBridge), so what the composer's commands call is reachable too.
export const CHAT_SLASH_COVERS: Record<string, string[]> = {
  '/broadcast': ['broadcastApi.sendBroadcast', 'broadcastApi.fetchBroadcastHistory'],
}
Object.assign(CHAT_SLASH_COVERS, { '/changelog': ['appVersion.fetchChangelogStatus', 'appVersion.changelogStatusForCommits'] })

// What the chat store invokes for the commands that talk in a room (say, log,
// dm, unread, open) and for the slash commands the composer's runner handles.
Object.assign(EXISTING_COVERS, {
  say: [
    'chatApi.createChannelMessage', 'chatApi.createDmMessage', 'chatE2E.sealMessageV2', 'chatE2E.sealEditV2', 'chatE2E.sendsV2', 'chatE2E.decryptMessage', 'chatE2E.decryptMessageFull',
  ],
  dm: ['chatApi.createConversation'],
})
Object.assign(CHAT_SLASH_COVERS, {
  '/siteban': ['chatApi.applySiteModeration', 'chatApi.listSiteModeration'],
  '/siteunban': ['chatApi.revokeSiteModeration'],
  '/ban': ['chatApi.banUser'],
  '/unban': ['chatApi.unbanUser'],
  '/timeout': ['chatApi.timeoutMember'],
  '/untimeout': ['chatApi.clearMemberTimeout'],
  '/kick': ['chatApi.removeMember'],
  '/mute': ['chatApi.updateMember'],
  '/np': ['chatApi.createChannelCard'],
  '/help': ['chatApi.createChannelCard'],
})
