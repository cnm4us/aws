import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { FeedContext } from '../feed/context';
import { IconButton } from './IconButton';

const spaceIcons = {
  channel: require('../../assets/icons/channel.png'),
  group: require('../../assets/icons/group.png'),
  personal: require('../../assets/icons/personal.png'),
};

export function FeedHeader({ context, onSpaces, onMenu, onBackProfile }: {
  context: FeedContext; onSpaces: () => void; onMenu: () => void; onBackProfile?: () => void;
}) {
  const {width,fontScale}=useWindowDimensions();
  const stacked=width/fontScale<200;
  const name = context.kind === 'global' ? 'Global' : context.name;
  return <View style={styles.header}>
    <View style={[styles.row, stacked && styles.stacked]}>
      {onBackProfile&&<Pressable accessibilityRole="button" accessibilityLabel="Back to profile" onPress={onBackProfile} style={styles.back}><Image source={require('../../assets/icons/chevron.png')} accessible={false} style={styles.backIcon}/></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Choose space. Current space: ${name}${context.kind === 'space' ? `. ${context.type}` : ''}`}
        onPress={onSpaces} style={[styles.space, stacked && styles.fullSpace]}>
        {context.kind === 'space' && <Image source={spaceIcons[context.type]} accessible={false} style={styles.typeIcon}/>}
        <View style={styles.title}>
          <Text style={styles.name} numberOfLines={2}>{name}</Text>
        </View>
        <Image source={require('../../assets/icons/chevron.png')} accessible={false} style={styles.chevron} />
      </Pressable>
      <View style={stacked ? {alignSelf:'flex-end'} : undefined}><IconButton icon="menu" label="Open menu" onPress={onMenu} /></View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  header: { gap: 8 },
  back:{width:44,height:44,alignItems:'center',justifyContent:'center'},backIcon:{width:24,height:24,transform:[{rotate:'90deg'}]},
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stacked: { flexDirection: 'column-reverse', alignItems: 'stretch' },
  fullSpace: { flex: 0, width: '100%' },
  space: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0, paddingVertical: 4 },
  // iOS scales lineHeight with the font. Leave room for full glyph bounds;
  // the native Text default clips overflow at its measured line box.
  name: { color: '#fff', fontSize: 24, lineHeight: 32, fontWeight: '700', paddingVertical: 2, overflow: 'visible' },
  typeIcon: { width: 24, height: 24 },
  chevron: { width: 18, height: 18 },
});
