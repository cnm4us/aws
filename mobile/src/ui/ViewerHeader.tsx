import type {Ref} from 'react';
import {Keyboard,StyleSheet,Text,View} from 'react-native';
import {Action} from './Message';
import {IconButton} from './IconButton';

export function ViewerHeader({title,onMenu,onBack,backLabel='Back',menuDisabled=false,titleRef}:{title:string;onMenu?:()=>void;onBack?:()=>void;backLabel?:string;menuDisabled?:boolean;titleRef?:Ref<Text>}) {
  return <View style={styles.header}>
    <View style={styles.controls}>
      {onBack?<Action label={backLabel} onPress={onBack}/>:<View/>}
      {onMenu&&<IconButton icon="menu" label="Open menu" disabled={menuDisabled} onPress={()=>{Keyboard.dismiss();onMenu();}}/>}
    </View>
    <Text ref={titleRef} accessibilityRole="header" style={styles.title}>{title}</Text>
  </View>;
}
const styles=StyleSheet.create({header:{padding:20,gap:8},controls:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},title:{fontSize:28,fontWeight:'700',color:'#fff',flexShrink:1}});
