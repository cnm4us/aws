import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function Message({ title, message, busy, onRetry }: {
  title: string; message?: string; busy?: boolean; onRetry?: () => void;
}) {
  return (
    <View style={styles.message}>
      {busy && <ActivityIndicator color="#ffffff" size="large" />}
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {message && <Text style={styles.body}>{message}</Text>}
      {onRetry && <Action label="Try again" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, backgroundColor: 'rgba(24,24,28,0.85)', borderColor: '#62626b', borderWidth: 1 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18 },
  title: { color: '#ffffff', fontSize: 23, fontWeight: '700', textAlign: 'center' },
  body: { color: '#c7c7ce', fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
