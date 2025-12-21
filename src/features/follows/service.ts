import { DomainError, ForbiddenError } from '../../core/errors'
import { loadSpace } from '../../services/spaceMembership'
import { getPool } from '../../db'
import * as repo from './repo'

export async function getSpaceUserFollowSummary(spaceId: number, targetUserId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) {
    throw new DomainError('space_not_found', 'space_not_found', 404)
  }
  if (space.type !== 'group' && space.type !== 'channel') {
    throw new DomainError('unsupported_space_type', 'unsupported_space_type', 400)
  }
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    throw new DomainError('bad_user_id', 'bad_user_id', 400)
  }
  if (currentUserId === targetUserId) {
    return { following: false, followersCount: 0 }
  }
  return repo.getSummary(spaceId, targetUserId, currentUserId)
}

export async function followSpaceUser(spaceId: number, targetUserId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) {
    throw new DomainError('space_not_found', 'space_not_found', 404)
  }
  if (space.type !== 'group' && space.type !== 'channel') {
    throw new DomainError('unsupported_space_type', 'unsupported_space_type', 400)
  }
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    throw new DomainError('bad_user_id', 'bad_user_id', 400)
  }
  if (currentUserId === targetUserId) {
    throw new ForbiddenError('cannot_follow_self')
  }
  const summary = await repo.follow(spaceId, targetUserId, currentUserId)
  return summary
}

export async function unfollowSpaceUser(spaceId: number, targetUserId: number, currentUserId: number) {
  const db = getPool()
  const space = await loadSpace(spaceId, db)
  if (!space) {
    throw new DomainError('space_not_found', 'space_not_found', 404)
  }
  if (space.type !== 'group' && space.type !== 'channel') {
    throw new DomainError('unsupported_space_type', 'unsupported_space_type', 400)
  }
  if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
    throw new DomainError('bad_user_id', 'bad_user_id', 400)
  }
  if (currentUserId === targetUserId) {
    throw new ForbiddenError('cannot_unfollow_self')
  }
  const summary = await repo.unfollow(spaceId, targetUserId, currentUserId)
  return summary
}

