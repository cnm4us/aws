export const CARD_GAP = 16;
export const PAGE_PADDING = 20;

/** Width is derived from the safe content container, never from card text. */
export function cardLayout(contentWidth: number, fontScale = 1) {
  const width = Math.max(0, contentWidth);
  const columns = fontScale >= 1.3 ? 1 : width >= 920 ? 3 : width >= 600 ? 2 : 1;
  const listWidth = Math.max(0, (width - CARD_GAP * (columns - 1)) / columns);
  return {columns, listWidth, carouselWidth: columns > 1 ? listWidth : width * (fontScale >= 1.3 ? 1 : .84)};
}
