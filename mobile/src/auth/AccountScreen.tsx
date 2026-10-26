import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from './useAuth';
import { Action } from '../ui/Message';
import { accountPresentation } from './accountPresentation';

export function AccountScreen({onDone}:{onDone:()=>void}) {
  const {store,snapshot}=useAuth();
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  useEffect(()=>()=>store.cancelSignIn(),[store]);
  const { mode, busy, canSignOut, canRetrySaved }=accountPresentation(snapshot);
  const busyLabel = snapshot.status === 'signingIn' ? 'Signing in' : snapshot.status === 'signingOut' ? 'Signing out'
    : snapshot.status === 'restoring' ? 'Restoring sign-in' : 'Verifying saved sign-in';
  const submit=async()=>{
    if(busy || !email.trim() || !password)return;
    const secret=password;setPassword('');await store.signIn(email.trim(),secret);
    if(store.getSnapshot().status==='authenticated')onDone();
  };
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS==='ios'?'padding':undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">Account</Text>
      {mode==='signedIn' ? <>
        <Text style={styles.text}>Signed in as {snapshot.viewer?.displayName || 'Viewer'}</Text>
      </> : mode==='savedSession' ? <>
        <Text style={styles.text}>Your saved sign-in needs to be verified.</Text>
        {snapshot.viewer && <Text style={styles.text}>Saved account: {snapshot.viewer.displayName || 'Viewer'}</Text>}
        <Text style={styles.text}>Reconnect and retry, or sign out on this phone.</Text>
        {canRetrySaved && <Action label="Retry saved sign-in" onPress={()=>{void store.retryValidation();}} />}
      </> : <>
        <Text style={styles.text}>Sign in with your existing account to view your spaces.</Text>
        <Text style={styles.text}>Email</Text>
        <TextInput style={styles.input} accessibilityLabel="Email" autoCapitalize="none" autoCorrect={false}
          keyboardType="email-address" textContentType="username" autoComplete="username" editable={!busy}
          value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor="#a1a1aa" />
        <Text style={styles.text}>Password</Text>
        <TextInput style={styles.input} accessibilityLabel="Password" secureTextEntry autoCapitalize="none" autoCorrect={false}
          textContentType="password" autoComplete="current-password" editable={!busy} value={password} onChangeText={setPassword}
          onSubmitEditing={()=>{void submit();}} returnKeyType="go" placeholder="Password" placeholderTextColor="#a1a1aa" />
        {!busy && <Action label="Sign in" onPress={()=>{void submit();}} />}
      </>}
      {canSignOut && <Action label="Sign out" onPress={()=>{void store.signOut();}} />}
      {busy && <View style={styles.row}><Text style={styles.busyText}>{busyLabel}</Text></View>}
      {snapshot.message && <Text style={styles.error} accessibilityRole="alert">{snapshot.message}</Text>}
      <Action label={busy?'Cancel':'Done'} onPress={()=>{store.cancelSignIn();onDone();}} />
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles=StyleSheet.create({
  flex:{flex:1,backgroundColor:'#000'},content:{padding:24,gap:16},title:{color:'#fff',fontSize:26,fontWeight:'700'},
  text:{color:'#ddd',fontSize:17},input:{color:'#fff',borderWidth:1,borderColor:'#666',borderRadius:12,padding:14,fontSize:18,minHeight:52},
  error:{color:'#ffb4b4',fontSize:16,lineHeight:23},row:{flexDirection:'row',gap:12,alignItems:'center'},busyText:{color:'#ddd',fontSize:17,flexShrink:1},
});
