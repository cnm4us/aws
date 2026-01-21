#!/usr/bin/env python3

import argparse
import json
import math
import sys


def clamp(v, lo, hi):
  return max(lo, min(hi, v))


def hex_to_rgba(hex_str, alpha):
  s = (hex_str or "").strip()
  if not s.startswith("#") or len(s) != 7:
    return (1.0, 1.0, 1.0, alpha)
  r = int(s[1:3], 16) / 255.0
  g = int(s[3:5], 16) / 255.0
  b = int(s[5:7], 16) / 255.0
  return (r, g, b, alpha)

def luminance(rgb):
  r, g, b = rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b


def inset_pct_for_preset(preset):
  p = (preset or "").strip().lower()
  if p == "small":
    return 0.06
  if p == "large":
    return 0.14
  return 0.10

def pct_to_px(pct, total_px):
  try:
    return float(total_px) * (float(pct) / 100.0)
  except Exception:
    return 0.0

def normalize_margin_pct(raw, fallback_pct):
  if raw is None:
    return float(fallback_pct)
  try:
    s = str(raw).strip()
    if s == "":
      return float(fallback_pct)
    n = float(s)
    if not math.isfinite(n):
      return float(fallback_pct)
    return clamp(n, 0.0, 40.0)
  except Exception:
    return float(fallback_pct)


def normalize_position(pos):
  raw = (pos or "top").strip().lower()
  if raw in ("middle", "center", "middle_center"):
    return "middle"
  if raw.startswith("bottom"):
    return "bottom"
  return "top"

def normalize_alignment(aln):
  raw = (aln or "center").strip().lower()
  if raw == "left":
    return "left"
  if raw == "right":
    return "right"
  return "center"


def rounded_rect(ctx, x, y, w, h, r):
  r = max(0.0, min(r, min(w, h) / 2.0))
  if r <= 0.0:
    ctx.rectangle(x, y, w, h)
    return
  ctx.new_sub_path()
  ctx.arc(x + w - r, y + r, r, -math.pi / 2.0, 0.0)
  ctx.arc(x + w - r, y + h - r, r, 0.0, math.pi / 2.0)
  ctx.arc(x + r, y + h - r, r, math.pi / 2.0, math.pi)
  ctx.arc(x + r, y + r, r, math.pi, 3.0 * math.pi / 2.0)
  ctx.close_path()


def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--input-json", required=True)
  ap.add_argument("--out", required=True)
  args = ap.parse_args()

  try:
    with open(args.input_json, "r", encoding="utf-8") as f:
      payload = json.load(f)
  except Exception as e:
    sys.stderr.write(f"failed_read_input_json: {e}\n")
    return 2

  text = str(payload.get("text") or "").replace("\r\n", "\n").strip()
  if not text:
    sys.stderr.write("missing_text\n")
    return 2

  frame = payload.get("frame") or {}
  width = int(frame.get("width") or 0)
  height = int(frame.get("height") or 0)
  if width <= 0 or height <= 0:
    sys.stderr.write("invalid_frame\n")
    return 2

  preset = payload.get("preset") or {}
  style = str(preset.get("style") or "pill").strip().lower()
  # Legacy support: old presets used style='outline' to mean "no background + outlined text".
  # We now model this as style='none' with explicit outline settings.
  if style == "outline":
    style = "none"
  pos = normalize_position(preset.get("position"))
  aln = normalize_alignment(preset.get("alignment"))
  font_size_pct = float(preset.get("fontSizePct") or 4.5)
  font_size_pct = clamp(font_size_pct, 2.0, 8.0)
  max_width_pct_raw = preset.get("maxWidthPct")
  try:
    max_width_pct = clamp(float(max_width_pct_raw or 90.0), 20.0, 100.0) / 100.0
  except Exception:
    max_width_pct = 0.90

  tracking_pct = float(preset.get("trackingPct") or 0.0)
  tracking_pct = clamp(tracking_pct, -20.0, 50.0)

  # Margins (pct of frame). If not provided, fall back to legacy inset presets.
  has_any_margin = (
    preset.get("marginLeftPct") is not None
    or preset.get("marginRightPct") is not None
    or preset.get("marginTopPct") is not None
    or preset.get("marginBottomPct") is not None
  )
  inset_x_pct = inset_pct_for_preset(preset.get("insetXPreset")) * 100.0
  inset_y_pct = inset_pct_for_preset(preset.get("insetYPreset") or "medium") * 100.0
  margin_left_pct = normalize_margin_pct(preset.get("marginLeftPct"), inset_x_pct)
  margin_right_pct = normalize_margin_pct(preset.get("marginRightPct"), inset_x_pct)
  margin_top_pct = normalize_margin_pct(preset.get("marginTopPct"), inset_y_pct)
  margin_bottom_pct = normalize_margin_pct(preset.get("marginBottomPct"), inset_y_pct)

  font_color = str(preset.get("fontColor") or "#ffffff")
  bg_color = str(preset.get("pillBgColor") or "#000000")
  bg_opacity_pct = float(preset.get("pillBgOpacityPct") or 55.0)
  bg_opacity = clamp(bg_opacity_pct / 100.0, 0.0, 1.0)

  font_gradient_key = preset.get("fontGradientKey")
  if font_gradient_key is not None:
    font_gradient_key = str(font_gradient_key).strip()
    if font_gradient_key == "":
      font_gradient_key = None

  # Font: curated list via fontKey -> (family, weight, style).
  # NOTE: font files are provided via assets/fonts and discovered through Fontconfig.
  def resolve_font(font_key: str):
    raw = str(font_key or "").strip()
    k = raw.lower()
    # Defaults
    family = "DejaVu Sans"
    weight = "UltraBold"
    style0 = "normal"

    # Dynamic Fontconfig keys: fc:<family>:<style>
    if raw.startswith("fc:"):
      try:
        import urllib.parse
        parts = raw.split(":", 2)
        if len(parts) == 3:
          fam = urllib.parse.unquote(parts[1])
          sty = urllib.parse.unquote(parts[2])
          if fam:
            family = fam
          s = (sty or "").strip()
          sl = s.lower()
          style0 = "italic" if ("italic" in sl or "oblique" in sl) else "normal"
          if "ultra" in sl or "black" in sl:
            weight = "UltraBold"
          elif "heavy" in sl:
            weight = "Heavy"
          elif "semibold" in sl or "demibold" in sl:
            weight = "SemiBold"
          elif "medium" in sl:
            weight = "Medium"
          elif "bold" in sl:
            weight = "Bold"
          else:
            weight = "Normal"
          return family, weight, style0
      except Exception:
        pass

    if k == "dejavu_sans_regular":
      family, weight, style0 = "DejaVu Sans", "Normal", "normal"
    elif k == "dejavu_sans_bold":
      # Slightly heavier than Bold so the PNG preview matches the on-page CSS (800–900).
      family, weight, style0 = "DejaVu Sans", "UltraBold", "normal"
    elif k == "dejavu_sans_italic":
      family, weight, style0 = "DejaVu Sans", "Normal", "italic"
    elif k == "dejavu_sans_bold_italic":
      family, weight, style0 = "DejaVu Sans", "UltraBold", "italic"
    elif k == "caveat_regular":
      family, weight, style0 = "Caveat", "Normal", "normal"
    elif k == "caveat_medium":
      family, weight, style0 = "Caveat", "Medium", "normal"
    elif k == "caveat_semibold":
      family, weight, style0 = "Caveat", "SemiBold", "normal"
    elif k == "caveat_bold":
      family, weight, style0 = "Caveat", "Bold", "normal"
    return family, weight, style0

  font_key = str(preset.get("fontKey") or "dejavu_sans_bold")
  font_family, font_weight, font_style = resolve_font(font_key)
  font_px = height * (font_size_pct / 100.0)
  font_px = clamp(font_px, 8.0, 220.0)

  # Outline settings (optional overrides; when unset, use style defaults).
  outline_width_pct_raw = preset.get("outlineWidthPct")
  outline_opacity_pct_raw = preset.get("outlineOpacityPct")
  outline_color_raw = preset.get("outlineColor")

  outline_width_px_default = 1.0 if style == "outline" else (0.9 if style in ("pill", "strip") else 0.0)
  outline_opacity_default = 0.45 if style == "outline" else (0.25 if style in ("pill", "strip") else 0.0)

  outline_width_px = outline_width_px_default
  if outline_width_pct_raw is not None and str(outline_width_pct_raw).strip() != "":
    try:
      outline_width_pct = float(outline_width_pct_raw)
      outline_width_px = font_px * (outline_width_pct / 100.0)
    except Exception:
      outline_width_px = outline_width_px_default
  outline_width_px = clamp(outline_width_px, 0.0, 12.0)

  outline_opacity = outline_opacity_default
  if outline_opacity_pct_raw is not None and str(outline_opacity_pct_raw).strip() != "":
    try:
      outline_opacity = clamp(float(outline_opacity_pct_raw) / 100.0, 0.0, 1.0)
    except Exception:
      outline_opacity = outline_opacity_default

  # Import GI only after validating args; yields clearer error if missing.
  try:
    import gi  # type: ignore
    gi.require_foreign("cairo")
    gi.require_version("Pango", "1.0")
    gi.require_version("PangoCairo", "1.0")
    from gi.repository import Pango, PangoCairo  # type: ignore
    import cairo  # type: ignore
  except Exception as e:
    sys.stderr.write(f"missing_pango_deps: {e}\n")
    return 3

  surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, width, height)
  ctx = cairo.Context(surface)
  ctx.set_source_rgba(0.0, 0.0, 0.0, 0.0)
  ctx.set_operator(cairo.OPERATOR_SOURCE)
  ctx.paint()
  ctx.set_operator(cairo.OPERATOR_OVER)

  layout = PangoCairo.create_layout(ctx)
  fd = Pango.FontDescription()
  fd.set_family(font_family)
  if font_weight.lower() == "ultrabold":
    fd.set_weight(Pango.Weight.ULTRABOLD)
  elif font_weight.lower() == "heavy":
    fd.set_weight(Pango.Weight.HEAVY)
  elif font_weight.lower() == "semibold":
    fd.set_weight(Pango.Weight.SEMIBOLD)
  elif font_weight.lower() == "medium":
    fd.set_weight(Pango.Weight.MEDIUM)
  else:
    fd.set_weight(Pango.Weight.BOLD if font_weight.lower() == "bold" else Pango.Weight.NORMAL)
  if font_style.lower() == "italic":
    fd.set_style(Pango.Style.ITALIC)
  elif font_style.lower() == "oblique":
    fd.set_style(Pango.Style.OBLIQUE)
  else:
    fd.set_style(Pango.Style.NORMAL)
  fd.set_absolute_size(int(font_px * Pango.SCALE))
  layout.set_font_description(fd)

  # Constrain layout width so that the final pill (text + padding + stroke/shadow)
  # fits within the X inset on both sides; otherwise we end up clamping the pill
  # against one edge, producing visibly asymmetric margins.
  pad_x0 = 0.0
  pad_y0 = 0.0
  stroke_pad0 = max(1.5, outline_width_px * 1.5)
  shadow_dx0 = 0.0
  shadow_dy0 = 2.0
  if style in ("pill", "strip"):
    pad_x0 = clamp(font_px * 0.45, 8.0, 40.0)
    pad_y0 = clamp(font_px * 0.30, 6.0, 28.0)
  margin_left_px0 = pct_to_px(margin_left_pct, width)
  margin_right_px0 = pct_to_px(margin_right_pct, width)
  max_box_w_allowed0 = max(10.0, width - margin_left_px0 - margin_right_px0)
  max_layout_w_allowed0 = max(10.0, max_box_w_allowed0 - (2.0 * (pad_x0 + stroke_pad0)) - abs(shadow_dx0))
  max_w = max_layout_w_allowed0
  # Legacy: if no explicit margins were provided, respect maxWidthPct.
  if not has_any_margin:
    max_w = min(width * max_width_pct, max_layout_w_allowed0)
  max_w = max(10.0, max_w)
  layout.set_width(int(max_w * Pango.SCALE))
  layout.set_wrap(Pango.WrapMode.WORD_CHAR)
  if aln == "left":
    layout.set_alignment(Pango.Alignment.LEFT)
  elif aln == "right":
    layout.set_alignment(Pango.Alignment.RIGHT)
  else:
    layout.set_alignment(Pango.Alignment.CENTER)
  # Clamp to N lines so the text box always fits within the vertical margins.
  # (Pango line-height is font-dependent; we use a conservative approximation.)
  margin_top_px0 = pct_to_px(margin_top_pct, width)
  margin_bottom_px0 = pct_to_px(margin_bottom_pct, width)
  max_box_h_allowed0 = max(10.0, height - margin_top_px0 - margin_bottom_px0)
  max_layout_h_allowed0 = max(10.0, max_box_h_allowed0 - (2.0 * (pad_y0 + stroke_pad0)) - abs(shadow_dy0))
  approx_line_h0 = max(1.0, font_px * 1.20)
  max_lines0 = int(max_layout_h_allowed0 / approx_line_h0)
  if max_lines0 < 1:
    max_lines0 = 1
  if max_lines0 > 30:
    max_lines0 = 30
  layout.set_height(-max_lines0)
  layout.set_ellipsize(Pango.EllipsizeMode.END)

  # Text shaping on by default; allow \n.
  layout.set_text(text, -1)

  if tracking_pct != 0.0:
    # Pango letter spacing is in Pango units (Pango.SCALE == 1024 units per device unit).
    # GI bindings expose this as attr_letter_spacing_new().
    letter_px = font_px * (tracking_pct / 100.0)
    try:
      new_fn = getattr(Pango, "attr_letter_spacing_new", None)
      if callable(new_fn):
        attrs = Pango.AttrList()
        a = new_fn(int(letter_px * Pango.SCALE))
        a.start_index = 0
        a.end_index = len(text.encode("utf-8"))
        attrs.insert(a)
        layout.set_attributes(attrs)
    except Exception:
      pass

  ink, logical = layout.get_pixel_extents()
  # Prefer ink extents for sizing backgrounds (pill) so we don't clip glyphs.
  # logical extents can undercount depending on font metrics / stroke / layout alignment.
  content_x = float(ink.x)
  content_y = float(ink.y)
  content_w = float(ink.width) if ink.width > 0 else float(logical.width)
  content_h = float(ink.height) if ink.height > 0 else float(logical.height)

  # Padding around text for pill background.
  pad_x = 0.0
  pad_y = 0.0
  if style in ("pill", "strip"):
    pad_x = clamp(font_px * 0.45, 8.0, 40.0)
    pad_y = clamp(font_px * 0.30, 6.0, 28.0)

  # Extra padding for stroke + shadow so text never touches/overflows the pill.
  # (We draw shadow with a small positive y offset, and we may stroke glyph paths.)
  stroke_pad = stroke_pad0
  shadow_dx = 0.0
  shadow_dy = 2.0

  # Margins are expressed as pct-of-width for both axes so that a given numeric
  # value yields a visually similar pixel margin horizontally and vertically
  # across portrait/landscape and different aspect ratios.
  margin_left_px = pct_to_px(margin_left_pct, width)
  margin_right_px = pct_to_px(margin_right_pct, width)
  margin_top_px = pct_to_px(margin_top_pct, width)
  margin_bottom_px = pct_to_px(margin_bottom_pct, width)

  # Compute a bounding box in layout coordinates that should fit on-screen.
  box_x0 = content_x - pad_x - stroke_pad
  box_y0 = content_y - pad_y - stroke_pad
  box_w = content_w + 2.0 * (pad_x + stroke_pad) + abs(shadow_dx)
  box_h = content_h + 2.0 * (pad_y + stroke_pad) + abs(shadow_dy)

  # Position the bounding box, then derive the layout draw origin.
  if aln == "left":
    box_x = margin_left_px
  elif aln == "right":
    box_x = width - box_w - margin_right_px
  else:
    box_x = (width - box_w) / 2.0
  box_x = clamp(box_x, margin_left_px, width - box_w - margin_right_px)

  min_y = margin_top_px
  max_y = height - box_h - margin_bottom_px
  if pos == "bottom":
    box_y = max_y
  elif pos == "middle":
    box_y = (height - box_h) / 2.0
  else:
    box_y = min_y
  box_y = clamp(box_y, min_y, max_y)

  x_draw = box_x - box_x0
  y_draw = box_y - box_y0

  if style == "pill":
    # Draw the pill at the computed bounding box position.
    pill_x = box_x
    pill_y = box_y
    pill_w = box_w
    pill_h = box_h
    radius = clamp(font_px * 0.45, 6.0, 22.0)
    rr, gg, bb, aa = hex_to_rgba(bg_color, bg_opacity)
    ctx.set_source_rgba(rr, gg, bb, aa)
    rounded_rect(ctx, pill_x, pill_y, pill_w, pill_h, radius)
    ctx.fill()
  elif style == "strip":
    # Full-width strip between left/right margins (text still aligns within via Pango alignment).
    strip_x = margin_left_px
    strip_w = max(10.0, width - margin_left_px - margin_right_px)
    rr, gg, bb, aa = hex_to_rgba(bg_color, bg_opacity)
    ctx.set_source_rgba(rr, gg, bb, aa)
    ctx.rectangle(strip_x, box_y, strip_w, box_h)
    ctx.fill()

  # Simple shadow (offset only, no blur).
  shadow_a = 0.65
  if style in ("pill", "outline", "strip"):
    ctx.save()
    ctx.translate(x_draw + shadow_dx, y_draw + shadow_dy)
    ctx.set_source_rgba(0.0, 0.0, 0.0, shadow_a)
    PangoCairo.update_layout(ctx, layout)
    PangoCairo.show_layout(ctx, layout)
    ctx.restore()

  # Optional gradient fill (screen-sized PNG masked by glyphs).
  gradient_surface = None
  gradient_pattern = None
  if font_gradient_key:
    try:
      import os
      # Prevent traversal: filenames only.
      if "/" not in font_gradient_key and "\\" not in font_gradient_key and ".." not in font_gradient_key:
        gp = os.path.join(os.getcwd(), "assets", "font_gradients", font_gradient_key)
        if os.path.isfile(gp):
          gradient_surface = cairo.ImageSurface.create_from_png(gp)
          gradient_pattern = cairo.SurfacePattern(gradient_surface)
          try:
            gradient_pattern.set_filter(cairo.FILTER_BILINEAR)
          except Exception:
            pass
          try:
            gradient_pattern.set_extend(cairo.EXTEND_PAD)
          except Exception:
            pass
    except Exception:
      gradient_surface = None
      gradient_pattern = None

  # Resolve outline color. If unset/'auto', choose a high-contrast color based on fontColor.
  outline_color = None
  if outline_color_raw is not None and str(outline_color_raw).strip() != "":
    s = str(outline_color_raw).strip()
    if s.lower() != "auto":
      outline_color = s

  if outline_color is None:
    fr, fg, fb, _ = hex_to_rgba(font_color, 1.0)
    # For gradients, "auto" is ambiguous; use fontColor as a hint and bias toward black.
    lum = luminance((fr, fg, fb))
    if gradient_pattern is not None:
      outline_color = "#000000"
    else:
      outline_color = "#000000" if lum > 0.55 else "#ffffff"

  # Draw: stroke (optional), then fill (solid or gradient).
  rr, gg, bb, aa = hex_to_rgba(font_color, 1.0)
  ctx.save()
  ctx.translate(x_draw, y_draw)
  PangoCairo.update_layout(ctx, layout)
  PangoCairo.layout_path(ctx, layout)
  if outline_width_px > 0.0 and outline_opacity > 0.0:
    or_, og, ob, _oa = hex_to_rgba(outline_color, outline_opacity)
    ctx.set_source_rgba(or_, og, ob, outline_opacity)
    ctx.set_line_width(outline_width_px)
    ctx.stroke_preserve()
  if gradient_pattern is not None and gradient_surface is not None:
    gw = float(gradient_surface.get_width())
    gh = float(gradient_surface.get_height())
    sx = gw / float(width) if width > 0 else 1.0
    sy = gh / float(height) if height > 0 else 1.0
    m = cairo.Matrix(sx, 0.0, 0.0, sy, x_draw * sx, y_draw * sy)
    gradient_pattern.set_matrix(m)
    ctx.set_source(gradient_pattern)
  else:
    ctx.set_source_rgba(rr, gg, bb, aa)
  ctx.fill()
  ctx.restore()

  try:
    surface.write_to_png(args.out)
  except Exception as e:
    sys.stderr.write(f"failed_write_png: {e}\n")
    return 4

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
