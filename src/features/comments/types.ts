export type CommentStatus = 'visible' | 'hidden'

export type CommentRow = {
  id: number
  publication_id: number
  user_id: number
  parent_id: number | null
  body: string
  status: CommentStatus
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type CommentDTO = {
  id: number
  publicationId: number
  userId: number
  parentId: number | null
  displayName: string
  email: string | null
  body: string
  status: CommentStatus
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
}

