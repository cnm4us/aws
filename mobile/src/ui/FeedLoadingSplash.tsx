import { ScrollView,StyleSheet,View } from 'react-native';
import { FeedLoadingBar } from './FeedLoadingBar';
import { Action,Message } from './Message';

export function FeedLoadingSplash({feedName='Global',error,onRetry,onCancel}:{feedName?:string;error?:string|null;onRetry?:()=>void;onCancel?:()=>void}){
  return <View style={styles.screen} accessibilityViewIsModal>
    {error?<Message title={`Cannot load ${feedName}`} message={error} onRetry={onRetry}/>:<ScrollView style={{flex:1}} contentContainerStyle={styles.center}><FeedLoadingBar label={`Loading ${feedName}…`}/></ScrollView>}
    {onCancel&&<View style={styles.actions}><Action label="Cancel feed loading" onPress={onCancel}/></View>}
  </View>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:'#000'},center:{flexGrow:1,justifyContent:'center',padding:20},actions:{padding:20,alignItems:'center'}});
