import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {Store} from './model';
type Env = {VITE_SUPABASE_URL?:string;VITE_SUPABASE_ANON_KEY?:string};
const env=(import.meta as unknown as {env:Env}).env;
export const supabase:SupabaseClient|null=env.VITE_SUPABASE_URL&&env.VITE_SUPABASE_ANON_KEY?createClient(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_ANON_KEY):null;
let baseline:Store|null=null;
let queue:Promise<void>=Promise.resolve();
export async function loadRemote():Promise<{store:Store|null;role:string;name:string;id:string;operations:string[]}> {
  if(!supabase) throw new Error('Supabase não configurado.');
  const {data:{user}}=await supabase.auth.getUser(); if(!user)throw new Error('Entre na sua conta.');
  const {data:profile,error:pe}=await supabase.from('users').select('*').eq('id',user.id).single();if(pe)throw pe;
  const {data,error}=await supabase.rpc('crm_load');if(error)throw error;
  baseline=structuredClone(data as Store);
  return {store:data as Store,role:profile.role,name:profile.name,id:user.id,operations:profile.operations};
}
export async function saveRemote(store:Store){
  const snapshot=structuredClone(store);
  const run=async()=>{
    if(!supabase||!baseline)throw new Error('Supabase não configurado.');
    const payload:Record<string,unknown>={};
    for(const key of ['leads','tasks','appointments','team','rules','campaigns'] as const){
      const before=baseline[key] as {id:string}[],after=snapshot[key] as {id:string}[];
      const changes=after.filter(v=>JSON.stringify(v)!==JSON.stringify(before.find(b=>b.id===v.id))).map(v=>({id:v.id,data:v,old:before.find(b=>b.id===v.id)||null}));
      const removed=before.filter(b=>!after.some(v=>v.id===b.id)).map(b=>({id:b.id,data:null,old:b}));
      if(changes.length||removed.length)payload[key]=[...changes,...removed];
    }
    if(JSON.stringify(snapshot.settings)!==JSON.stringify(baseline.settings))payload.settings={data:snapshot.settings,old:baseline.settings};
    if(!Object.keys(payload).length)return;
    const {error}=await supabase.rpc('crm_save',{payload});if(error)throw error;
    for(const key of ['leads','tasks','appointments','team','rules','campaigns'] as const)if(payload[key])Object.assign(baseline,{[key]:snapshot[key]});
    if(payload.settings)baseline.settings=snapshot.settings;
  };
  const pending=queue.then(run,run);queue=pending.catch(()=>{});return pending;
}
