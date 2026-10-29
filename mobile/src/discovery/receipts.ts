import AsyncStorage from '@react-native-async-storage/async-storage';
const values=new Map<string,string>();
const key=(origin:string)=>`viewer:anonymous-entry:${encodeURIComponent(origin)}`;
export function entryReceiptHeader(origin:string,path:string):Record<string,string> {
  const value=values.get(origin);
  return value&&/^\/api\/viewer\/v1\/(?:feed\/global|discovery\/spaces\/(?:global|\d+)\/entry)(?:[/?]|$)/.test(path)?{'X-Space-Entry-Receipt':value}:{};
}
export async function loadAnonymousReceipt(origin:string) {const value=await AsyncStorage.getItem(key(origin));if(value&&value.length<=512)values.set(origin,value);}
export async function saveAnonymousReceipt(origin:string,value:unknown) {
  if(typeof value!=='string'||value.length>512||!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value))throw Error('Invalid entry acknowledgment.');
  values.set(origin,value);await AsyncStorage.setItem(key(origin),value);
}
export async function clearAnonymousReceipt(origin:string){values.delete(origin);await AsyncStorage.removeItem(key(origin));}
