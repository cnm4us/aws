import { CONTROL_LANE } from '../ui/IconButton';
import { memo, useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { FeedVideoItem } from './types';
import type { TextResources } from '../content/resources';
import { PublicationPanel } from '../content/StoryPanel';
import type {feedGeometry} from './feedGeometry';

export const FeedCard = memo(function FeedCard({ item, height, headerHeight, children, onCreator, resources, active = true, onStoryExpanded, onStoryInteracting, onTextHeight,geometry }: {
  geometry?:ReturnType<typeof feedGeometry>;
  item: FeedVideoItem; height: number; headerHeight?:number; children?: ReactNode; onCreator?:(id:number)=>void;
  onStoryInteracting?: (interacting: boolean) => void;
  resources?: TextResources; active?: boolean; onStoryExpanded?: (expanded: boolean) => void; onTextHeight?: (height: number) => void;
}) {
  const [noticeHeight, setNoticeHeight] = useState(0);
  const pictureBottom=geometry?.visibleHeight??height;
  return (
    <View style={[styles.card, { height }]}>
      {item.posterUrl && <View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:0,height:pictureBottom,overflow:'hidden'}}><Image source={{ uri: item.posterUrl }} resizeMode="contain" style={geometry?.knownSize?{position:'absolute',left:0,top:geometry.mediaTop,width:geometry.width,height:geometry.mediaHeight}:StyleSheet.absoluteFill}/></View>}
      {children}
      <View testID="publication-position" style={[styles.caption,{bottom:height-pictureBottom+20}]} pointerEvents="box-none" onLayout={event => onTextHeight?.(event.nativeEvent.layout.height)}>
        <PublicationPanel item={item} resources={resources} active={active} height={pictureBottom} headerHeight={(headerHeight??0)+(!item.playbackUrl?noticeHeight:0)}
          onCreator={onCreator} onExpanded={onStoryExpanded} onInteracting={onStoryInteracting}/>
        {!item.playbackUrl && <Text style={styles.description} onLayout={event=>setNoticeHeight(event.nativeEvent.layout.height+8)}>This video is unavailable. Swipe to continue.</Text>}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: '#000000', overflow: 'hidden' },
  caption: { position: 'absolute', left: 20, right: CONTROL_LANE.textRight },
  description: { color: '#ffffff', fontSize: 15, lineHeight: 21, marginTop: 8, textShadowColor: '#000000', textShadowRadius: 8 },
});
