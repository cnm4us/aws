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


def inset_pct_for_preset(preset):
  p = (preset or "").strip().lower()
  if p == "small":
    return 0.06
  if p == "large":
    return 0.14
  return 0.10


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
  pos = normalize_position(preset.get("position"))
  aln = normalize_alignment(preset.get("alignment"))
  font_size_pct = float(preset.get("fontSizePct") or 4.5)
  font_size_pct = clamp(font_size_pct, 2.0, 8.0)
  max_width_pct = float(preset.get("maxWidthPct") or 90.0)
  max_width_pct = clamp(max_width_pct, 20.0, 100.0) / 100.0

  tracking_pct = float(preset.get("trackingPct") or 0.0)
  tracking_pct = clamp(tracking_pct, -20.0, 50.0)

  x_inset = inset_pct_for_preset(preset.get("insetXPreset"))
  y_inset = inset_pct_for_preset(preset.get("insetYPreset") or "medium")

  font_color = str(preset.get("fontColor") or "#ffffff")
  bg_color = str(preset.get("pillBgColor") or "#000000")
  bg_opacity_pct = float(preset.get("pillBgOpacityPct") or 55.0)
  bg_opacity = clamp(bg_opacity_pct / 100.0, 0.0, 1.0)

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
  stroke_pad0 = 1.5
  shadow_dx0 = 0.0
  if style == "pill":
    pad_x0 = clamp(font_px * 0.45, 8.0, 40.0)
  inset_x_px0 = width * x_inset
  max_box_w_allowed0 = max(10.0, width - (2.0 * inset_x_px0))
  max_layout_w_allowed0 = max(10.0, max_box_w_allowed0 - (2.0 * (pad_x0 + stroke_pad0)) - abs(shadow_dx0))
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
  # Clamp to max 30 lines; ellipsize if needed.
  layout.set_height(-30)
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
  if style == "pill":
    pad_x = clamp(font_px * 0.45, 8.0, 40.0)
    pad_y = clamp(font_px * 0.30, 6.0, 28.0)

  # Extra padding for stroke + shadow so text never touches/overflows the pill.
  # (We draw shadow with a small positive y offset, and we may stroke glyph paths.)
  stroke_pad = 1.5
  shadow_dx = 0.0
  shadow_dy = 2.0

  inset_x_px = width * x_inset
  inset_y_px = height * y_inset

  # Compute a bounding box in layout coordinates that should fit on-screen.
  box_x0 = content_x - pad_x - stroke_pad
  box_y0 = content_y - pad_y - stroke_pad
  box_w = content_w + 2.0 * (pad_x + stroke_pad) + abs(shadow_dx)
  box_h = content_h + 2.0 * (pad_y + stroke_pad) + abs(shadow_dy)

  # Position the bounding box, then derive the layout draw origin.
  if aln == "left":
    box_x = inset_x_px
  elif aln == "right":
    box_x = width - box_w - inset_x_px
  else:
    box_x = (width - box_w) / 2.0
  box_x = clamp(box_x, inset_x_px, width - box_w - inset_x_px)

  if pos == "bottom":
    box_y = height - box_h - inset_y_px
  elif pos == "middle":
    box_y = (height - box_h) / 2.0
  else:
    box_y = inset_y_px

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

  # Simple shadow (offset only, no blur).
  shadow_a = 0.65
  if style in ("pill", "outline", "strip"):
    ctx.save()
    ctx.translate(x_draw + shadow_dx, y_draw + shadow_dy)
    ctx.set_source_rgba(0.0, 0.0, 0.0, shadow_a)
    PangoCairo.update_layout(ctx, layout)
    PangoCairo.show_layout(ctx, layout)
    ctx.restore()

  # Outline: stroke the glyph path, then fill.
  if style == "outline":
    ctx.save()
    ctx.translate(x_draw, y_draw)
    PangoCairo.update_layout(ctx, layout)
    PangoCairo.layout_path(ctx, layout)
    ctx.set_source_rgba(0.0, 0.0, 0.0, 0.45)
    ctx.set_line_width(1.0)
    ctx.stroke_preserve()
    rr, gg, bb, aa = hex_to_rgba(font_color, 1.0)
    ctx.set_source_rgba(rr, gg, bb, aa)
    ctx.fill()
    ctx.restore()
  else:
    rr, gg, bb, aa = hex_to_rgba(font_color, 1.0)
    ctx.save()
    ctx.translate(x_draw, y_draw)
    PangoCairo.update_layout(ctx, layout)
    PangoCairo.layout_path(ctx, layout)
    # Add a very subtle outline for pill/strip to better match browser-rendered
    # system fonts (which often look heavier than DejaVu Sans Bold).
    if style in ("pill", "strip"):
      ctx.set_source_rgba(0.0, 0.0, 0.0, 0.25)
      ctx.set_line_width(0.9)
      ctx.stroke_preserve()
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
