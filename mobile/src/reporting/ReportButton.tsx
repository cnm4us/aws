import {useEffect,useSyncExternalStore} from 'react';
import {Image,Pressable,StyleSheet,Text} from 'react-native';
import {ReportMemory} from './reportMemory';
const flag=require('../../assets/icons/flag.png'),filled=require('../../assets/icons/flag-filled.png');
export function ReportButton({publicationId,reportedByMe,memory,eligible,onPress}:{publicationId:number;reportedByMe:boolean;memory:ReportMemory;eligible:boolean;onPress:()=>void}) {
 useSyncExternalStore(memory.subscribe,memory.getSnapshot);
 useEffect(()=>{memory.seed(publicationId,reportedByMe);},[memory,publicationId,reportedByMe]);
 useEffect(()=>()=>memory.clearDrafts(),[memory,publicationId]);
 const sent=memory.sent(publicationId);
 return <Pressable accessibilityRole="button" accessibilityLabel={sent?'Report already sent':'Report video'} accessibilityState={{selected:sent,disabled:!eligible}} disabled={!eligible} onPress={onPress} style={styles.action}>
  <Image accessible={false} source={sent?filled:flag} style={styles.icon}/><Text style={styles.caption} numberOfLines={1}>{sent?'Sent':'Flag'}</Text>
 </Pressable>;
}
const styles=StyleSheet.create({action:{width:44,minHeight:64,alignItems:'center',justifyContent:'center',gap:3,borderRadius:12,backgroundColor:'rgba(24,24,28,0.25)',borderWidth:1,borderColor:'#777'},icon:{width:24,height:24},caption:{fontSize:12,color:'#fff',maxWidth:44}});
