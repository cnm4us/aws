import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { fetch as expoFetch } from 'expo/fetch';
import { AuthStore, type AuthSnapshot } from './authStore';
import { createNativeSessionApi } from './api';
import { createSessionStorage } from './sessionStorage';
import { AppState } from 'react-native';

export const nativeFetch=expoFetch as unknown as typeof fetch;
const Context=createContext<{store:AuthStore;snapshot:AuthSnapshot;baseUrl:string}|null>(null);
export function AuthProvider({baseUrl,children}:{baseUrl:string;children:ReactNode}) {
  const store=useMemo(()=>new AuthStore(baseUrl,createNativeSessionApi(baseUrl,nativeFetch),createSessionStorage({
    getItem:key=>SecureStore.getItemAsync(key),
    setItem:(key,value)=>SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),
    removeItem:key=>SecureStore.deleteItemAsync(key),
  },AsyncStorage,baseUrl)),[baseUrl]);
  const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot);
  useEffect(()=>{void store.restore();return store.dispose;},[store]);
  useEffect(()=>{
    const validate=()=>{if(['authenticated','unavailable'].includes(store.getSnapshot().status))void store.validate();};
    const sub=AppState.addEventListener('change',state=>{if(state==='active')validate();});
    const timer=setInterval(()=>{if(AppState.currentState==='active' && store.getSnapshot().status==='authenticated')validate();},60_000);
    return()=>{sub.remove();clearInterval(timer);};
  },[store]);
  return <Context.Provider value={{store,snapshot,baseUrl}}>{children}</Context.Provider>;
}
export function useAuth() {const auth=useContext(Context);if(!auth)throw new Error('AuthProvider missing');return auth;}
