import {createClient} from 'npm:@supabase/supabase-js@2';
export const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
export const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
export function secret(name:string){const value=Deno.env.get(name);if(!value)throw new Error('Secret ausente: '+name);return value;}
export function admin(){return createClient(secret('SUPABASE_URL'),secret('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});}
export async function caller(req:Request){const header=req.headers.get('Authorization');if(!header?.startsWith('Bearer '))throw new Error('Autenticação obrigatória');const db=createClient(secret('SUPABASE_URL'),secret('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:header}},auth:{persistSession:false}});const {data:{user},error}=await db.auth.getUser(header.slice(7));if(error||!user)throw new Error('Sessão inválida');return {db,user};}
export async function sendWhatsApp(operation:string,to:string,text:string,attachment?:{url:string;type:string;name:string}){
 const suffix=operation==='AUREON'?'AUREON':'GR_INVEST',token=secret('WHATSAPP_TOKEN_'+suffix),phoneId=secret('WHATSAPP_PHONE_ID_'+suffix),version=secret('META_GRAPH_VERSION');
 const base={messaging_product:'whatsapp',to:to.replace(/\D/g,''),type:'text',text:{body:text}};
 let payload:unknown=base;
 if(attachment){const mediaType=attachment.type.startsWith('image/')?'image':attachment.type.startsWith('audio/')?'audio':'document';payload={messaging_product:'whatsapp',to:to.replace(/\D/g,''),type:mediaType,[mediaType]:{link:attachment.url,...(mediaType==='document'?{filename:attachment.name}:{}),...(mediaType!=='audio'&&text?{caption:text.slice(0,1024)}:{})}};}
 const r=await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await r.json();if(!r.ok)throw new Error(result.error?.message||'WhatsApp recusou o envio.');return result;
}
