import {useEffect,useRef} from 'react';
import {AccessibilityInfo,findNodeHandle,Image,Pressable,StyleSheet,Text,View} from 'react-native';
export type RuleSection='description'|'allowed'|'disallowed';
const labels:Record<RuleSection,string>={description:'Long Description',allowed:'Allowed Examples',disallowed:'Disallowed Examples'};
export function focusReportControl(node:View|null|undefined){if(node){const handle=findNodeHandle(node);if(handle)AccessibilityInfo.setAccessibilityFocus(handle);}}
export function RuleSectionMenu({value,open,disabled,onOpen,onSelect}:{value:RuleSection;open:boolean;disabled:boolean;onOpen:(open:boolean)=>void;onSelect:(section:RuleSection)=>void}) {
 const trigger=useRef<View>(null),choices=useRef(new Map<RuleSection,View>()),wasOpen=useRef(false);
 useEffect(()=>{if(open)focusReportControl(choices.current.get(value));else if(wasOpen.current)focusReportControl(trigger.current);wasOpen.current=open;},[open,value]);
 return <View style={styles.container}>
  <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`Rule section: ${labels[value]}`} accessibilityHint="Choose description or examples" accessibilityState={{expanded:open,disabled}} disabled={disabled} onPress={()=>onOpen(!open)} style={styles.trigger}>
   <Text style={styles.text}>{labels[value]}</Text><Image accessible={false} source={require('../../assets/icons/chevron.png')} style={[styles.arrow,open&&styles.flipped]}/>
  </Pressable>
  {open&&<View accessibilityRole="radiogroup" accessibilityLabel="Rule explanation section" style={styles.choices}>
   {(Object.keys(labels) as RuleSection[]).map(section=><Pressable key={section} ref={node=>{if(node)choices.current.set(section,node);else choices.current.delete(section);}} accessibilityRole="radio" accessibilityLabel={labels[section]} accessibilityState={{checked:value===section,disabled}} disabled={disabled} onPress={()=>onSelect(section)} style={[styles.choice,value===section&&styles.selected]}>
    <Text style={styles.text}>{labels[section]}</Text>{value===section&&<Text accessible={false} style={styles.check}>✓</Text>}
   </Pressable>)}
   <Pressable accessibilityRole="button" accessibilityLabel="Cancel section selection" onPress={()=>onOpen(false)} style={styles.choice}><Text style={styles.text}>Cancel</Text></Pressable>
  </View>}
 </View>;
}
const styles=StyleSheet.create({container:{gap:8},trigger:{minHeight:48,padding:12,borderWidth:1,borderColor:'#777',borderRadius:10,flexDirection:'row',alignItems:'center',gap:12},text:{color:'#fff',fontSize:17,flexShrink:1},arrow:{width:20,height:20,marginLeft:'auto'},flipped:{transform:[{rotate:'180deg'}]},choices:{gap:6},choice:{minHeight:48,padding:12,borderRadius:10,flexDirection:'row',alignItems:'center',gap:12},selected:{backgroundColor:'#33333c'},check:{color:'#fff',fontSize:18,marginLeft:'auto'}});
