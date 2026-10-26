import { Pressable, StyleSheet, Text, ScrollView, View } from 'react-native';

export function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onPress={onPress} style={[styles.button, disabled && { opacity: .5 }]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Message({ title, message, busy, busyLabel, onRetry, scrollable = true }: {
  title: string; message?: string; busy?: boolean; busyLabel?: string; onRetry?: () => void; scrollable?: boolean;
}) {
  const content = <>
      <Text style={styles.title} accessibilityRole="header" accessibilityState={busy?{busy:true}:undefined}>{title}</Text>
      {busy && busyLabel && <Text style={styles.body}>{busyLabel}</Text>}
      {message && <Text style={styles.body}>{message}</Text>}
      {onRetry && <Action label="Try again" onPress={onRetry} />}
  </>;
  // Parent scrolling screens own their scroll area; bounded feed errors own theirs.
  return scrollable ? <ScrollView style={{flex:1}} contentContainerStyle={styles.message}>{content}</ScrollView> :
    <View style={styles.message}>{content}</View>;
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 64, maxWidth: '100%', flexShrink: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, backgroundColor: 'rgba(24,24,28,0.85)', borderColor: '#62626b', borderWidth: 1 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
  message: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18 },
  title: { color: '#ffffff', fontSize: 23, fontWeight: '700', textAlign: 'center' },
  body: { color: '#c7c7ce', fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
