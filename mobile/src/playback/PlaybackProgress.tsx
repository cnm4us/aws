import {useLayoutEffect,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,View,type GestureResponderEvent} from 'react-native';
import type {PlaybackCoordinator,PlaybackSnapshot} from './coordinator';
import type {NativePlayerPort} from './useFeedPlayback';
import {clampTime,formatTime,timeAt,validDuration} from './seekMath';

export type ProgressGesturePort={ready():boolean;begin(x:number):boolean;move(x:number):void;end(x:number):void;cancel():void};
export function PlaybackProgress({coordinator,snapshot,visible,enabled,top,height,left=16,right=16,registerGesture}:{
 coordinator:PlaybackCoordinator<NativePlayerPort>;snapshot:PlaybackSnapshot<NativePlayerPort>;
 visible:boolean;enabled:boolean;top:number;height:number;left?:number;right?:number;registerGesture?:(port:ProgressGesturePort|null)=>void;
}){
 const [clock,setClock]=useState({time:0,duration:0}),[width,setWidth]=useState(0),[preview,setPreview]=useState<number|null>(null);
 const dragging=useRef(false),live=useRef({enabled,visible,width,clock});live.current={enabled,visible,width,clock};
 const phase=snapshot.seekPhase??'idle',activation=snapshot.activation;
 useLayoutEffect(()=>{
  if(!visible||!snapshot.player){setClock({time:0,duration:0});return;}
  const player=snapshot.player;
  try{return player.subscribeClock(seconds=>{const duration=player.durationSeconds?.()??0;setClock({time:Number.isFinite(seconds)?Math.max(0,seconds):0,duration:validDuration(duration)?duration:0});});}
  catch{setClock({time:0,duration:0});}
 },[snapshot.player,visible,snapshot.seekRevision]);
 useLayoutEffect(()=>{if(phase==='idle'){dragging.current=false;setPreview(null);}},[phase]);
 useLayoutEffect(()=>()=>{dragging.current=false;if(coordinator.getSnapshot().activation===activation)coordinator.cancelSeek();},[coordinator,activation,top,height,width,visible]);
 const available=()=>{const l=live.current;return l.enabled&&l.visible&&l.width>0&&validDuration(l.clock.duration)&&coordinator.getSnapshot().activation===activation&&coordinator.getSnapshot().seekPhase==='idle';};
 const point=(event:GestureResponderEvent)=>timeAt(event.nativeEvent.locationX,live.current.width,live.current.clock.duration);
 const start=(event:GestureResponderEvent)=>{if(!available()||!coordinator.beginSeek())return;dragging.current=true;setPreview(point(event));};
 const move=(event:GestureResponderEvent)=>{if(dragging.current)setPreview(point(event));};
 const release=(event:GestureResponderEvent)=>{if(!dragging.current)return;dragging.current=false;const seconds=point(event);setPreview(seconds);if(!coordinator.commitSeek(seconds))coordinator.cancelSeek();};
 const gesture=useRef<ProgressGesturePort|null>(null);
 gesture.current={ready:available,begin:x=>{if(!available()||!coordinator.beginSeek())return false;dragging.current=true;setPreview(timeAt(x,live.current.width,live.current.clock.duration));return true;},
  move:x=>{if(dragging.current)setPreview(timeAt(x,live.current.width,live.current.clock.duration));},
  end:x=>{if(!dragging.current)return;dragging.current=false;const seconds=timeAt(x,live.current.width,live.current.clock.duration);setPreview(seconds);if(!coordinator.commitSeek(seconds))coordinator.cancelSeek();},
  cancel:()=>{dragging.current=false;coordinator.cancelSeek();}};
 useLayoutEffect(()=>{registerGesture?.({ready:()=>gesture.current?.ready()??false,begin:x=>gesture.current?.begin(x)??false,move:x=>gesture.current?.move(x),end:x=>gesture.current?.end(x),cancel:()=>gesture.current?.cancel()});return()=>registerGesture?.(null);},[registerGesture]);
 const adjust=(direction:number)=>{if(!available()||!coordinator.beginSeek())return;const seconds=clampTime((snapshot.player?.currentTime?.()??clock.time)+direction*5,clock.duration);setPreview(seconds);if(!coordinator.commitSeek(seconds))coordinator.cancelSeek();};
 if(!visible)return null;
 const duration=clock.duration,time=phase==='idle'?Math.min(clock.time,duration||clock.time):preview??coordinator.checkpoint().positionSeconds;
 const thumbSize=phase==='dragging'||phase==='seeking'?12:8;
 const ratio=duration>0?Math.max(0,Math.min(1,time/duration)):0,disabled=!enabled||width<=0||!duration||phase!=='idle';
 return <View testID="playback-progress" style={{position:'absolute',top,left,right,height,backgroundColor:'#000'}}>
  <View testID="playback-seek-track" style={{height,width:'100%'}} onLayout={event=>setWidth(event.nativeEvent.layout.width)}
   accessible accessibilityRole="adjustable" accessibilityLabel="Video position" accessibilityHint="Swipe up or down to seek five seconds"
   accessibilityState={{disabled,busy:phase==='seeking'}} accessibilityValue={{min:0,max:Math.max(0,duration),now:Math.min(time,duration||0),text:duration?`${formatTime(time)} of ${formatTime(duration)}`:'Duration unavailable'}}
   accessibilityActions={[{name:'increment',label:'Forward five seconds'},{name:'decrement',label:'Back five seconds'}]}
   onAccessibilityAction={event=>{if(event.nativeEvent.actionName==='increment')adjust(1);if(event.nativeEvent.actionName==='decrement')adjust(-1);}}
   onStartShouldSetResponder={()=>available()} onMoveShouldSetResponder={()=>available()}
   onResponderGrant={start} onResponderMove={move} onResponderRelease={release}
   onResponderTerminationRequest={()=>false} onResponderTerminate={()=>{dragging.current=false;coordinator.cancelSeek();}}>
   <View pointerEvents="none" style={{height:3,backgroundColor:'#51545a'}}><View style={{height:3,width:`${ratio*100}%`,backgroundColor:duration?'#fff':'#51545a'}}/></View>
   {duration>0&&<View testID="playback-thumb" pointerEvents="none" style={{position:'absolute',top:(3-thumbSize)/2,left:Math.max(0,Math.min(width-thumbSize,ratio*width-thumbSize/2)),width:thumbSize,height:thumbSize,borderRadius:thumbSize/2,backgroundColor:'#fff'}}/>}
   {phase!=='idle'&&phase!=='error'&&<View pointerEvents="none" style={styles.times}><Text style={styles.text}>{formatTime(time)} / {formatTime(duration)}</Text>{phase==='seeking'&&<Text style={styles.text}>Seeking…</Text>}</View>}
  </View>
  {phase==='error'&&<View style={styles.error}>
   <Text accessibilityRole="alert" style={[styles.text,{flex:1}]}>Cannot seek</Text>
   <Pressable accessibilityRole="button" accessibilityLabel="Retry video seek" style={styles.button} onPress={coordinator.retrySeek}><Text style={styles.text}>Retry</Text></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel="Cancel video seek" style={styles.button} onPress={coordinator.cancelSeek}><Text style={styles.text}>Cancel</Text></Pressable>
  </View>}
 </View>;
}
const styles=StyleSheet.create({text:{color:'#fff',fontSize:14,lineHeight:20},times:{paddingTop:14,flexDirection:'row',justifyContent:'space-between'},error:{position:'absolute',top:4,left:0,right:0,bottom:0,flexDirection:'row',alignItems:'center',gap:8},button:{minHeight:44,minWidth:44,justifyContent:'center',paddingHorizontal:8}});
