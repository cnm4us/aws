import { type ProductionRow } from '../../db'

export type ProductionRecord = ProductionRow & {
  upload?: {
    id: number
    original_filename: string
    modified_filename: string
    description: string | null
    status: string
    size_bytes: number | null
    width: number | null
    height: number | null
    created_at: string
    // enhanced poster fields (optional)
    poster_portrait_cdn?: string
    poster_cdn?: string
    poster_portrait_s3?: string
    poster_s3?: string
  }
}

