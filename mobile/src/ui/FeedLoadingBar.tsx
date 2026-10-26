import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';

// Deliberately indeterminate: bytes/percent of a feed becoming playable are unknown.
export function FeedLoadingBar({label='Loading new Feed'}:{label?:string}={}) {
  const position = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let mounted = true, revision = 0;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { revision++; if (mounted) setReduceMotion(value); });
    const initial = revision;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted && revision === initial) setReduceMotion(value); }).catch(() => {});
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    position.setValue(0);
    if (reduceMotion || !width) return;
    const animation = Animated.loop(Animated.timing(position, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true, isInteraction: false }));
    animation.start(); return () => { animation.stop(); };
  }, [position, reduceMotion, width]);
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityState={{ busy: true }} style={styles.container}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.track} onLayout={event => setWidth(event.nativeEvent.layout.width)} accessible={false}>
      <Animated.View style={[styles.segment, { transform: [{ translateX: reduceMotion ? width * .325 : position.interpolate({ inputRange: [0, 1], outputRange: [-width * .35, width] }) }] }]} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  container: { alignSelf: 'stretch', padding: 16, gap: 10 },
  label: { color: '#fff', fontSize: 18, textAlign: 'center', flexShrink: 1 },
  track: { height: 5, overflow: 'hidden', borderRadius: 3, backgroundColor: '#41414a' },
  segment: { width: '35%', height: 5, backgroundColor: '#b9d6ff', borderRadius: 3 },
});
