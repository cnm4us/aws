import { useState } from 'react';
import { Image,Keyboard,Modal,Pressable,ScrollView,StyleSheet,Text,View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action } from '../ui/Message';

type Order='newest'|'oldest';
export function CommentOrderSelector({count,order,disabled,onSelect}:{count:number|null;order:Order;disabled:boolean;onSelect:(order:Order)=>void}) {
 const [open,setOpen]=useState(false);
 const label=order==='oldest'?'Oldest':`${count??'—'} Comments`;
 const dismiss=()=>setOpen(false);
 return <>
  <View style={styles.selectorRow}>
   <Pressable accessibilityRole="button" accessibilityLabel={`${label}. Sort comments. Current order: ${order==='newest'?'Newest':'Oldest'}`}
    accessibilityHint="Opens Newest and Oldest choices" accessibilityState={{expanded:open,disabled}} disabled={disabled}
    onPress={()=>{Keyboard.dismiss();setOpen(true);}} style={[styles.selector,disabled&&{opacity:.5}]}>
    <Text style={styles.label}>{label}</Text>
    <Image accessible={false} source={require('../../assets/icons/chevron.png')} style={styles.arrow}/>
   </Pressable>
  </View>
  {open&&<Modal transparent visible animationType="fade" onRequestClose={dismiss}>
   <SafeAreaView style={styles.backdrop}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss sort options" onPress={dismiss} style={StyleSheet.absoluteFill}/>
    <View accessibilityViewIsModal style={styles.panel}>
     <ScrollView contentContainerStyle={styles.choices} keyboardShouldPersistTaps="handled">
      <View accessibilityRole="radiogroup" accessibilityLabel="Comment order" style={styles.choices}>
       {(['newest','oldest'] as const).map(choice=><Pressable key={choice} accessibilityRole="radio"
        accessibilityLabel={choice==='newest'?'Newest':'Oldest'} accessibilityState={{checked:order===choice,disabled}} disabled={disabled}
        onPress={()=>{dismiss();onSelect(choice);}} style={[styles.choice,order===choice&&styles.selected]}>
        <Text style={styles.choiceText}>{choice==='newest'?'Newest':'Oldest'}</Text>
        {order===choice&&<Text accessible={false} allowFontScaling={false} style={styles.check}>✓</Text>}
       </Pressable>)}
      </View>
      <Action label="Cancel" onPress={dismiss}/>
     </ScrollView>
    </View>
   </SafeAreaView>
  </Modal>}
 </>;
}
const styles=StyleSheet.create({
 selectorRow:{alignItems:'center'},selector:{minHeight:44,maxWidth:'100%',paddingHorizontal:12,paddingVertical:8,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
 label:{color:'#fff',fontSize:20,fontWeight:'600',textAlign:'center',flexShrink:1},arrow:{width:20,height:20},
 backdrop:{flex:1,justifyContent:'center',alignItems:'center',padding:24,backgroundColor:'rgba(0,0,0,0.65)'},
 panel:{width:'100%',maxWidth:420,maxHeight:'90%',padding:20,borderRadius:20,backgroundColor:'#18181c',borderWidth:1,borderColor:'#62626b'},
 choices:{gap:12},choice:{minHeight:52,padding:14,borderRadius:12,borderWidth:1,borderColor:'#62626b',flexDirection:'row',alignItems:'center',gap:12},
 selected:{borderColor:'#fff',backgroundColor:'#33333c'},choiceText:{color:'#fff',fontSize:18,fontWeight:'600',flex:1},check:{color:'#fff',fontSize:20},
});
