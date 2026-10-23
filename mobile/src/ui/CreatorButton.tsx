import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
export function CreatorButton({name,avatarUrl,onPress,disabled}:{name:string;avatarUrl:string|null;onPress:()=>void;disabled?:boolean}) {
  const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[avatarUrl]);
  return <Pressable accessibilityRole="button" accessibilityLabel={`View ${name}'s profile`} accessibilityState={{disabled:!!disabled}} disabled={disabled}
    onPress={onPress} style={[styles.button,disabled && {opacity:.5}]}>
    <Image accessible={false} source={avatarUrl&&!failed?{uri:avatarUrl}:require('../../assets/icons/personal.png')} onError={()=>setFailed(true)}
      style={avatarUrl&&!failed?styles.avatar:styles.fallback}/>
  </Pressable>;
}
const styles=StyleSheet.create({button:{height:44,width:44,borderRadius:22,borderWidth:1,borderColor:'#777',backgroundColor:'rgba(24,24,28,0.25)',alignItems:'center',justifyContent:'center'},
  avatar:{height:40,width:40,borderRadius:20},fallback:{height:24,width:24}});
