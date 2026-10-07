import {admin,secret,sendWhatsApp} from '../_shared/client.ts';
type Route={organization_id:string;operation:'AUREON'|'GR-INVEST'};
async function verifySignature(raw:string,signature:string|null){if(!signature?.startsWith('sha256='))return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret('META_APP_SECRET')),{name:'HMAC',hash:'SHA-256'},false,['verify']);const hex=signature.slice(7);if(!/^[0-9a-f]{64}$/i.test(hex))return false;return crypto.subtle.verify('HMAC',key,new Uint8Array(hex.match(/../g)!.map(s=>parseInt(s,16))),new TextEncoder().encode(raw));}
const prompts=['Qual é seu nome?','Qual o objetivo do crédito?','Qual valor de crédito deseja?','Quanto possui para entrada?','Em quantos meses pretende contratar?','Em qual cidade você mora?','Qual o melhor horário para conversar?'];
Deno.serve(async(req)=>{
 if(req.method==='GET'){const u=new URL(req.url);return u.searchParams.get('hub.verify_token')===secret('META_VERIFY_TOKEN')?new Response(u.searchParams.get('hub.challenge')||''):new Response('Invalid token',{status:403});}
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const raw=await req.text();if(!await verifySignature(raw,req.headers.get('x-hub-signature-256')))return new Response('Invalid signature',{status:401});
 const db=admin(),routes:Record<string,Route>=JSON.parse(secret('WHATSAPP_ROUTES'));
 try{const payload=JSON.parse(raw);for(const entry of payload.entry||[])for(const change of entry.changes||[]){const value=change.value,route=routes[value.metadata?.phone_number_id];if(!route)continue;
  for(const message of value.messages||[]){
   const {data:event}=await db.from('integration_events').select('processed').eq('id',message.id).maybeSingle();if(event?.processed)continue;
   if(!event){const {error}=await db.from('integration_events').insert({id:message.id,organization_id:route.organization_id,event_type:'whatsapp.received',payload:message});if(error){if(error.code==='23505')continue;throw error;}}
   const {data:existing,error:findError}=await db.from('leads').select('*').eq('organization_id',route.organization_id).eq('operation',route.operation).eq('phone_normalized',message.from).maybeSingle();if(findError)throw findError;
   const {data:org}=await db.from('organizations').select('settings').eq('id',route.organization_id).single();const config=org?.settings.byOperation?.[route.operation]||org?.settings;
   const text=message.text?.body||`[${message.type} recebido · mídia disponível no WhatsApp]`,now=new Date().toISOString(),time=new Date(Number(message.timestamp)*1000).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
   let lead=existing?.data;
   if(!lead){const {data:team}=await db.from('attendants').select('data').eq('organization_id',route.organization_id).eq('operation',route.operation);const available=(team||[]).map(t=>t.data).filter(t=>t.online);const agent=available.length?available[Math.floor(Date.now()/1000)%available.length].name:'Não atribuído';lead={id:crypto.randomUUID(),name:value.contacts?.find((c:{wa_id:string})=>c.wa_id===message.from)?.profile?.name||'Novo contato',phone:'+'+message.from,email:'',cpf:'',city:'',state:'',operation:route.operation,source:message.referral?'Meta Ads':'WhatsApp',campaign:message.referral?.source_id||'',utm_source:message.referral?'meta':'whatsapp',utm_medium:message.referral?'paid_social':'organic',utm_content:message.referral?.source_url||'',created:now,updated:now,stage:'Lead recebido',status:'Não atendidos',agent,score:0,value:0,entry:0,income:0,objective:'',term:12,tags:[],unread:0,messages:[],activities:[],proposals:[],docs:[],botStep:0};}
   if(lead.messages.some((m:{id:string})=>m.id===message.id)){await db.from('integration_events').update({processed:true}).eq('id',message.id);continue;}
   lead.messages.push({id:message.id,from:'lead',text,time});lead.unread=(lead.unread||0)+1;lead.updated=now;lead.lastInboundAt=now;lead.followupSent=[];
   let reply='';if(config?.botActive&&lead.botStep!==undefined&&lead.botStep<=7){const step=lead.botStep;
    if(step===0)reply=config.botGreeting+'\n'+prompts[0];
    else {const answer=text.trim();if(step===1)lead.name=answer; if(step===2)lead.objective=answer;if(step===3||step===4){const amount=Number(answer.replace(/[^0-9,]/g,'').replace(',','.'));if(!Number.isFinite(amount)||amount<0){reply='Informe um valor numérico, por exemplo 550000.';}else lead[step===3?'value':'entry']=amount;}if(step===5)lead.term=Number(answer.replace(/\D/g,''))||12;if(step===6)lead.city=answer;if(step===7)lead.bestTime=answer;
     if(!reply&&step<7)reply=prompts[step];if(step===7){lead.score=Math.min(100,(lead.value>0?20:0)+(lead.entry>=lead.value*.15&&lead.value>0?25:10)+(lead.term<=3?20:10)+15+(lead.objective?10:0));lead.stage='Qualificação';lead.status=lead.score>config.handoff?'Fila':'Não atendidos';reply=lead.score>config.handoff?'Seu perfil foi analisado e vou encaminhar você agora para um de nossos especialistas.':'Obrigado! Um especialista vai revisar seu perfil e entrar em contato.';}}
    if(!reply.startsWith('Informe'))lead.botStep=step+1;
   }
   if(reply){await sendWhatsApp(route.operation,message.from,reply);lead.messages.push({id:crypto.randomUUID(),from:'bot',text:reply,time});}
   lead.activities.push({id:crypto.randomUUID(),text:existing?'Mensagem recebida':'Lead recebido via WhatsApp',by:'WhatsApp',time:now});
   const {error}=await db.from('leads').upsert({id:lead.id,organization_id:route.organization_id,operation:route.operation,assigned_to:lead.agent,data:lead,updated_at:now});if(error)throw error;
   await db.from('integration_events').update({processed:true}).eq('id',message.id);
  }
 }return new Response('OK');}catch(e){console.error('Webhook failed',e instanceof Error?e.message:'unknown');return new Response('Processing failed',{status:500});}
});
