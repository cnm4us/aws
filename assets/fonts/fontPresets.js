/**
 * assets/fonts/fontPresets.js
 *
 * Curated, human-friendly size presets for Screen Title Styles.
 *
 * These values map directly to the numeric knobs used by our renderer:
 * - fontSizePct: % of frame HEIGHT (e.g. 4.5 => 4.5% of 1920px for portrait).
 * - trackingPct: % of fontSize (Pango letter spacing).
 * - lineSpacingPct: extra spacing between lines, % of fontSize (added on top of Pango default).
 *
 * Notes:
 * - familyKey values match /api/screen-title-fonts families[].familyKey.
 * - variant keys match the stored Screen Title preset "fontKey" values.
 *   Built-ins: dejavu_sans_bold, caveat_semibold, etc.
 *   Dynamic: fc:<family>:<style> (URL-encoded family/style).
 */

/** @type {'x_small'|'small'|'medium'|'large'|'x_large'} */
// eslint-disable-next-line no-unused-vars
const _FontSizeKey = null

module.exports = {
  schemaVersion: 1,

  // Calibration-only: the reference frame you should use while tuning values.
  baselineFrame: { width: 1080, height: 1920 },

  /** @type {Record<string, any>} */
  families: {
    // Built-in family (legacy keys)
    dejavu_sans: {
      label: 'DejaVu Sans',
      sizes: {
        x_small: { fontSizePct: 2.8, trackingPct: 0, lineSpacingPct: 0 },
        small: { fontSizePct: 3.4, trackingPct: 0, lineSpacingPct: 0 },
        medium: { fontSizePct: 4.2, trackingPct: 0, lineSpacingPct: 0 },
        large: { fontSizePct: 5.2, trackingPct: 0, lineSpacingPct: 0 },
        x_large: { fontSizePct: 6.4, trackingPct: 0, lineSpacingPct: 0 },
      },
      variants: {
        dejavu_sans_regular: { label: 'Regular' },
        dejavu_sans_bold: { label: 'Bold' },
        dejavu_sans_italic: { label: 'Italic' },
        dejavu_sans_bold_italic: { label: 'Bold Italic' },
      },
    },

    // Built-in family (legacy keys)
    caveat: {
      label: 'Caveat',
      sizes: {
        x_small: { fontSizePct: 3.2, trackingPct: 0, lineSpacingPct: 0 },
        small: { fontSizePct: 3.8, trackingPct: 0, lineSpacingPct: 0 },
        medium: { fontSizePct: 4.6, trackingPct: 0, lineSpacingPct: 0 },
        large: { fontSizePct: 5.6, trackingPct: 0, lineSpacingPct: 0 },
        x_large: { fontSizePct: 6.8, trackingPct: 0, lineSpacingPct: 0 },
      },
      variants: {
        caveat_regular: { label: 'Regular' },
        caveat_medium: { label: 'Medium' },
        caveat_semibold: { label: 'SemiBold' },
        caveat_bold: { label: 'Bold' },
      },
    },

    // Dynamic families discovered from assets/fonts via Fontconfig.
    aladin: {
      label: 'Aladin',
      sizes: {
        x_small: { fontSizePct: 2.9, trackingPct: 0, lineSpacingPct: 0 },
        small: { fontSizePct: 3.6, trackingPct: 0, lineSpacingPct: 0 },
        medium: { fontSizePct: 4.4, trackingPct: 0, lineSpacingPct: 0 },
        large: { fontSizePct: 5.4, trackingPct: 0, lineSpacingPct: 0 },
        x_large: { fontSizePct: 6.6, trackingPct: 0, lineSpacingPct: 0 },
      },
      variants: {
        // Aladin Regular.ttf
        'fc:Aladin:Regular': { label: 'Regular' },
      },
    },

    pirata_one: {
      label: 'Pirata One',
      sizes: {
        x_small: { fontSizePct: 2.9, trackingPct: 0, lineSpacingPct: 0 },
        small: { fontSizePct: 3.6, trackingPct: 0, lineSpacingPct: 0 },
        medium: { fontSizePct: 4.4, trackingPct: 0, lineSpacingPct: 0 },
        large: { fontSizePct: 5.4, trackingPct: 0, lineSpacingPct: 0 },
        x_large: { fontSizePct: 6.6, trackingPct: 0, lineSpacingPct: 0 },
      },
      variants: {
        // Pirata One Regular.ttf
        'fc:Pirata%20One:Regular': { label: 'Regular' },
      },
    },

    titan_one: {
      label: 'Titan One',
      sizes: {
        x_small: { fontSizePct: 2.6, trackingPct: 0, lineSpacingPct: 0 },
        small: { fontSizePct: 3.2, trackingPct: 0, lineSpacingPct: 0 },
        medium: { fontSizePct: 3.9, trackingPct: 0, lineSpacingPct: 0 },
        large: { fontSizePct: 4.8, trackingPct: 0, lineSpacingPct: 0 },
        x_large: { fontSizePct: 5.7, trackingPct: 0, lineSpacingPct: 0 },
      },
      variants: {
        // Titan One Regular.ttf
        'fc:Titan%20One:Regular': { label: 'Regular' },
      },
    },
  },
}
