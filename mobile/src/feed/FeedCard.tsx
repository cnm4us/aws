import { memo, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FeedVideoItem } from './types';

export const FeedCard = memo(function FeedCard({ item, height, children, onCreator }: {
  item: FeedVideoItem; height: number; children?: ReactNode; onCreator?:(id:number)=>void;
}) {
  return (
    <View style={[styles.card, { height }]}>
      {item.posterUrl && <Image source={{ uri: item.posterUrl }} resizeMode="contain" style={StyleSheet.absoluteFill} />}
      {children}
      <View style={styles.caption} pointerEvents="box-none">
        {item.creator.id && onCreator ? <Pressable onPress={()=>onCreator(item.creator.id!)} style={{minHeight:44,justifyContent:'center'}}
          accessibilityRole="button" accessibilityLabel={`View ${item.creator.displayName}'s profile`}>
          <Text style={styles.creator}>{item.creator.displayName}</Text>
        </Pressable> : <Text style={styles.creator}>{item.creator.displayName}</Text>}
        {item.description && <Text pointerEvents="none" style={styles.description} numberOfLines={3}>{item.description}</Text>}
        {!item.playbackUrl && <Text style={styles.description}>This video is unavailable. Swipe to continue.</Text>}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: '#000000', overflow: 'hidden' },
  caption: { position: 'absolute', left: 20, right: 96, bottom: 28 },
  creator: { color: '#ffffff', fontSize: 18, fontWeight: '700', textShadowColor: '#000000', textShadowRadius: 8 },
  description: { color: '#ffffff', fontSize: 15, lineHeight: 21, marginTop: 8, textShadowColor: '#000000', textShadowRadius: 8 },
});
