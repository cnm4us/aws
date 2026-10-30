import {Image,Pressable,StyleSheet,Text,View} from 'react-native';
import {priceLabel,type SpaceCard as Card} from './api';

export function SpaceCard({collectionLabels=false,space,baseUrl,width,largeText=false,saving=false,error,aboutRef,onOpen,onAbout,onSave}:{
  space:Card;collectionLabels?:boolean;baseUrl:string;width:number;largeText?:boolean;saving?:boolean;error?:string;
  aboutRef?:(node:View|null)=>void;onOpen:()=>void;onAbout:()=>void;onSave:()=>void;
}) {
  const name=space.type==='personal'&&!collectionLabels?'My Space':space.name;
  return <View testID={`space-card-${space.id}`} style={[styles.card,{width}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityHint="Opens this space" disabled={!!space.unavailable} accessibilityState={{disabled:!!space.unavailable}} onPress={onOpen} style={styles.primary}>
      {space.artworkUrl?<Image source={{uri:baseUrl+space.artworkUrl}} style={styles.artwork} accessible={false} resizeMode="cover"/>:
        <View style={styles.artwork}><Text style={styles.initial} accessible={false}>{name.slice(0,1)}</Text></View>}
      <Text style={styles.title} numberOfLines={largeText?undefined:2}>{name}</Text>
    </Pressable>
    <View style={styles.metadata}><View style={{flexDirection:'row',alignItems:'center',gap:6,flexShrink:1}}>{!space.global&&['group','channel'].includes(space.type)&&<Image source={space.type==='group'?require('../../assets/icons/group.png'):require('../../assets/icons/channel.png')} style={{width:20,height:20}} accessible={false}/>}<Text style={styles.kind}>{space.global?'Public feed':space.type==='personal'?(collectionLabels?'Personal space':'My Space'):space.type==='group'?'Group':'Channel'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}`} disabled={!!space.unavailable} accessibilityState={{disabled:!!space.unavailable}} onPress={onOpen} style={styles.iconButton}>
        <Image source={require('../../assets/icons/launch.png')} style={styles.launch} accessible={false}/>
      </Pressable>
    </View>
    {space.availability&&<Text style={styles.restriction}>{space.availability.label}</Text>}
    {space.availability?.price&&<Text style={styles.restriction}>{priceLabel(space.availability.price)}</Text>}
    {space.requiresSignIn&&<Text style={styles.restriction}>Sign in to enter</Text>}
    {!!space.description&&<Text style={styles.description} numberOfLines={largeText?undefined:3}>{space.description}</Text>}
    <View style={styles.footer}>
      <Pressable ref={aboutRef} accessibilityRole="button" accessibilityLabel={`About and rules for ${name}`} disabled={!!space.unavailable} accessibilityState={{disabled:!!space.unavailable}} onPress={onAbout} style={styles.about}><Text style={styles.aboutText}>About & Rules</Text></Pressable>
      {!space.global&&space.type!=='personal'&&<Pressable accessibilityRole="checkbox" accessibilityLabel={`Save ${name} to ${collectionLabels?(space.type==='group'?'Your Groups':'Your Channels'):'Your Spaces'}`}
        accessibilityState={{checked:space.saved,disabled:saving,busy:saving}} disabled={saving} onPress={onSave} style={[styles.iconButton,saving&&{opacity:.5}]}>
        <View style={[styles.checkbox,space.saved&&styles.checked]}><Text accessible={false} style={styles.checkmark}>{space.saved?'✓':''}</Text></View>
      </Pressable>}
    </View>
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}
const styles=StyleSheet.create({
  card:{backgroundColor:'#171c26',borderColor:'#343d4d',borderWidth:1,borderRadius:14,padding:14,gap:10,flexShrink:0},
  primary:{gap:12},artwork:{width:'100%',aspectRatio:2,borderRadius:8,backgroundColor:'#28394d',alignItems:'center',justifyContent:'center'},
  initial:{color:'#d5e7fa',fontSize:46},title:{color:'#fff',fontSize:20,fontWeight:'700'},
  metadata:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},kind:{color:'#a6c7ff',fontSize:15,flexShrink:1},
  iconButton:{width:44,minHeight:44,alignItems:'center',justifyContent:'center',flexShrink:0},launch:{width:24,height:24},
  restriction:{color:'#c9ceda',fontSize:15},description:{color:'#d2d7e2',fontSize:17,lineHeight:25},
  footer:{marginTop:'auto',paddingTop:8,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  about:{minHeight:44,justifyContent:'center',flexShrink:1},aboutText:{color:'#a6c7ff',fontSize:16,fontWeight:'600'},
  checkbox:{width:24,height:24,borderRadius:5,borderColor:'#96a6bb',borderWidth:2,alignItems:'center',justifyContent:'center'},
  checked:{backgroundColor:'#45d18a',borderColor:'#45d18a'},checkmark:{color:'#092418',fontSize:18,fontWeight:'800',lineHeight:20},
  error:{color:'#ffb8af',fontSize:15},
});
