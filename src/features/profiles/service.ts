import * as repo from './repo'

export type ProfileInput = {
  displayName: string
  avatarUrl?: string | null
  bio?: string | null
  isPublic?: boolean
  showBio?: boolean
}

export type ProfileUpdateInput = {
  displayName?: string
  avatarUrl?: string | null
  bio?: string | null
  isPublic?: boolean
  showBio?: boolean
}

export async function getProfile(userId: number) {
  if (!Number.isFinite(userId) || userId <= 0) return null
  return repo.getByUserId(userId)
}

export async function upsertProfile(userId: number, input: ProfileInput) {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('invalid_user_id')
  }
  const displayName = String(input.displayName || '').trim()
  if (!displayName) {
    throw new Error('display_name_required')
  }
  return repo.insert(userId, {
    displayName,
    avatarUrl: input.avatarUrl,
    bio: input.bio,
    isPublic: input.isPublic,
    showBio: input.showBio,
  })
}

export async function updateProfile(userId: number, input: ProfileUpdateInput) {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('invalid_user_id')
  }
  if (input.displayName !== undefined) {
    const trimmed = String(input.displayName || '').trim()
    if (!trimmed) {
      throw new Error('display_name_required')
    }
  }
  return repo.update(userId, input)
}
