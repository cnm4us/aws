// Temporary screens return to the existing feed owner. In React Navigation 7,
// navigate('Feed') pushes another Feed when a different screen is focused.
export function returnToFeed(navigation: { isFocused(): boolean; popTo(name: 'Feed'): void }) {
  // Successful sign-in can already replace the auth navigation group. A late
  // completion from its removed Account screen has nothing left to dismiss.
  if (navigation.isFocused()) navigation.popTo('Feed');
}
