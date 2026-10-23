import { Image, Pressable, StyleSheet, Text } from 'react-native';

const icons = {
  launch: require('../../assets/icons/launch.png'),
  soundOn: require('../../assets/icons/speaker-on.png'),
  soundOff: require('../../assets/icons/speaker-off.png'),
  menu: require('../../assets/icons/menu.png'),
};

export function IconButton({ icon, label, onPress, selected, disabled = false }: {
  icon: keyof typeof icons | 'cc'; label: string; onPress: () => void;
  selected?: boolean; disabled?: boolean;
}) {
  const opacity = selected === false || disabled ? .5 : 1;
  const playbackControl = icon === 'launch' || icon === 'cc' || icon === 'soundOn' || icon === 'soundOff';
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, pressed && styles.pressed, playbackControl && styles.playback]}>
    {icon === 'cc' ? <Text allowFontScaling={false} accessible={false} style={[styles.cc, { opacity }]}>CC</Text> :
      <Image source={icons[icon]} accessible={false} style={[styles.icon, { opacity }]} />}
  </Pressable>;
}

export const CONTROL_LANE = { right: 16, width: 44, textRight: 76 } as const;
const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(24,24,28,0.9)', borderWidth: 1, borderColor: '#777' },
  pressed: { backgroundColor: '#45454d' },
  playback: { backgroundColor: 'rgba(24,24,28,0.25)' },
  icon: { width: 24, height: 24 },
  cc: { color: '#fff', fontSize: 17, fontWeight: '800' },
});
