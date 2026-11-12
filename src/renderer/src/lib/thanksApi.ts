// The Thank you page. Administrators edit it on the server
// (/accounts/admin/thanks/), and every player reads /accounts/thanks/ when the
// page opens, so a change shows without a release. Until an admin saves one
// (`configured: false`) the page shows THANKS_DEFAULT. See backend
// docs/11-admin.md, "Admin: Thank you page".
import { routeUrl } from './apiServers'
import { apiRequest, authedRequest } from './apiClient'
import { getToken } from './userApi'

const PUBLIC_URL = routeUrl('/accounts/thanks/')
const ADMIN_URL = routeUrl('/accounts/admin/thanks/')

export const THANKS_ICONS = ['', 'heart', 'code', 'star', 'users', 'skull'] as const
export type ThanksIcon = typeof THANKS_ICONS[number]

export interface ThanksSection {
  title: string
  icon: ThanksIcon
  names: string[]
}

export interface ThanksPageContent {
  title: string
  intro: string
  footnote: string
  sections: ThanksSection[]
}

export interface ThanksPagePayload extends ThanksPageContent {
  /** False until an administrator saves the page; the fields are empty then. */
  configured: boolean
  updated_at: string | null
}

export interface ThanksAdminPayload extends ThanksPagePayload {
  updated_by: string | null
  available_icons: string[]
}

/** What the page shows before the server has one, and the wording an empty field falls back to. */
export const THANKS_DEFAULT: ThanksPageContent = {
  title: 'Thank you',
  intro: 'unreleased is free to use and kept running by donations from people like you. Every bit helps cover hosting and keeps the site ad-free. This page is our way of saying thanks.',
  footnote: 'Donated and don’t see your name here? Let us know and we’ll add it.',
  sections: [
    { title: 'With thanks to', icon: 'heart', names: ['bye bye @hostile_cat04', 'John Smith', 'Anonymous'] },
    { title: 'Built by', icon: 'code', names: ['saint', 'hackinhood (X)'] },
    { title: 'Fuck You (opps)', icon: '', names: ['Xig (fuck this nigga)', 'emzie', 'flow', 'Pure', 'fuckass nigga @yourealtwin'] },
  ],
}

/** The page to show: the server's when configured (blank fields take the default wording), else the default. */
export function resolveThanks(payload: ThanksPagePayload | null): ThanksPageContent {
  if (!payload?.configured) return THANKS_DEFAULT
  return {
    title: payload.title || THANKS_DEFAULT.title,
    intro: payload.intro || THANKS_DEFAULT.intro,
    footnote: payload.footnote || THANKS_DEFAULT.footnote,
    sections: Array.isArray(payload.sections) ? payload.sections : [],
  }
}

/** Public. Falls back to the last copy fetched when offline. */
export function getThanksPage(signal?: AbortSignal): Promise<ThanksPagePayload> {
  return apiRequest(PUBLIC_URL, { signal, cacheKey: 'thanks-page' })
}

export function getThanksAdmin(signal?: AbortSignal): Promise<ThanksAdminPayload> {
  return authedRequest(ADMIN_URL, { signal }, getToken())
}

/** Replaces the whole page. Administrators with two-factor only. */
export function saveThanksPage(content: ThanksPageContent): Promise<ThanksAdminPayload> {
  return authedRequest(ADMIN_URL, { method: 'PUT', body: JSON.stringify(content) }, getToken())
}

/** Deletes the server's page, so players go back to THANKS_DEFAULT. */
export function resetThanksPage(): Promise<ThanksAdminPayload> {
  return authedRequest(ADMIN_URL, { method: 'DELETE' }, getToken())
}
