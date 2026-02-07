export type LibrarySourceOption = {
  value: string
  label: string
}

export const librarySourceOptions: LibrarySourceOption[] = [
  { value: "cspan", label: "CSPAN" },
  { value: "glenn kirschner", label: "Glenn Kirschner" },
  { value: "justice connection", label: "Justice Connection" },
  { value: "other", label: "Other" },
];

export const librarySourceValues = librarySourceOptions.map((opt) => opt.value)
export const librarySourceValueSet = new Set(librarySourceValues)

export function getLibrarySourceLabel(value: string | null | undefined): string | null {
  const v = String(value || '').trim().toLowerCase()
  if (!v) return null
  const hit = librarySourceOptions.find((opt) => opt.value === v)
  return hit ? hit.label : null
}
