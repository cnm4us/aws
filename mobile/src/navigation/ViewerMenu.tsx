import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAuth} from '../auth/useAuth';
import {accountPresentation} from '../auth/accountPresentation';
import {Action} from '../ui/Message';
import {IconButton} from '../ui/IconButton';
import {playbackDiagnostics} from '../diagnostics/development';
import {sharePlaybackDiagnostics} from '../diagnostics/share';

export function ViewerMenu({onAccount,onSettings,onClose,onRefresh,onReadiness,onHome,onSaved,onFollowing,onGlobal,onCreations,onGroups,onChannels,onAbout,current}: {
 onFollowing?:()=>void;onGlobal?:()=>void;onCreations?:()=>void;onGroups?:()=>void;onChannels?:()=>void;current?:string;onHome?:()=>void;onSaved?:()=>void;onAbout?:()=>void;
 onAccount:()=>void;onSettings:()=>void;onClose:()=>void;onRefresh?:()=>void;onReadiness?:()=>void;
}) {
 const {store,snapshot}=useAuth();const {mode,busy,canSignOut}=accountPresentation(snapshot);
 const item=(name:string,route:string,action:()=>void,description?:string)=><Pressable key={route} accessibilityRole="button" accessibilityLabel={name}
  accessibilityState={{selected:current===route,disabled:route==='Account'&&busy&&current!=='Account'}} disabled={route==='Account'&&busy&&current!=='Account'} onPress={action}
  style={[styles.item,current===route&&styles.selected]}><Text style={styles.label}>{name}{current===route?'  ✓':''}</Text>{description&&<Text style={styles.detail}>{description}</Text>}</Pressable>;
 return <SafeAreaView style={styles.screen} edges={['top','bottom','left','right']}>
  <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>Menu</Text><IconButton icon="close" label="Close menu" onPress={onClose}/></View>
  <ScrollView contentContainerStyle={styles.content}>
   {onHome&&item('Home','Home',onHome)}
   {onFollowing&&item('Following','Following',onFollowing)}
   {onGlobal&&item('Global','Global',onGlobal)}
   {onCreations&&item('Your Creations','YourCreations',onCreations)}
   {onGroups&&item('Your Groups','YourGroups',onGroups)}
   {onChannels&&item('Your Channels','YourChannels',onChannels)}
   {onSaved&&item('Your Spaces','YourSpaces',onSaved)}
   {item('Account','Account',onAccount,mode==='signIn'?'Sign in':mode==='savedSession'?'Retry saved sign-in':snapshot.viewer?`Signed in as ${snapshot.viewer.displayName||'Viewer'}`:undefined)}
   <View style={styles.divider}/>
   {onAbout&&<Action label="About & Rules" onPress={onAbout}/>}
   <Action label="Settings" onPress={onSettings}/>
   {canSignOut&&<Action label={mode==='signedIn'?'Sign out':'Sign out on this phone'} disabled={busy} onPress={()=>{if(store.getSnapshot().generation===snapshot.generation&&!accountPresentation(store.getSnapshot()).busy)void store.signOut();}}/>}
   {onRefresh&&<Action label="Refresh feed" disabled={busy} onPress={onRefresh}/>}
   {playbackDiagnostics&&<Action label="Playback diagnostics" onPress={sharePlaybackDiagnostics}/>}
   {playbackDiagnostics&&onReadiness&&<Action label="Feed readiness check" onPress={onReadiness}/>}
   {snapshot.message&&<Text style={styles.message} accessibilityRole="alert">{snapshot.message}</Text>}
  </ScrollView>
 </SafeAreaView>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:'#000'},header:{padding:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},title:{color:'#fff',fontSize:28,fontWeight:'700'},content:{padding:20,gap:16},item:{minHeight:52,padding:14,borderRadius:12,borderWidth:1,borderColor:'#62626b',gap:6},selected:{borderColor:'#9cd0ff',backgroundColor:'#1b2c3e'},label:{color:'#fff',fontSize:19,fontWeight:'600'},detail:{color:'#c9ceda',fontSize:15},divider:{height:1,backgroundColor:'#343d4d',marginVertical:4},message:{color:'#ffb4b4',fontSize:16}});
