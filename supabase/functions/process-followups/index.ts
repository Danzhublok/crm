import {admin,secret,sendWhatsApp} from '../_shared/client.ts';
import {runAutomations} from '../_shared/automations.ts';
// Schedule externally with pg_cron/pg_net. Templates are required outside the
// WhatsApp customer-service window; those cases create a human task instead.
Deno.serve(async(req)=>{
 if(req.headers.get('x-cron-secret')!==secret('CRON_SECRET'))return new Response('Unauthorized',{status:401});
 const db=admin(),{data:rows,error}=await db.from('leads').select('*').limit(500);if(error)return new Response('Database failed',{status:500});
 let sent=0,queued=0;
 for(const row of rows||[]){if(!['Convertido','Perdido'].includes(row.data.stage))await runAutomations(db,row);const lead=row.data;if(['Convertido','Perdido'].includes(lead.stage)||lead.status!=='Aguardando resposta')continue;
  const lastReceived=lead.messages.filter((m:{from:string})=>m.from==='lead').at(-1);if(!lastReceived)continue;
  const {data:org}=await db.from('organizations').select('settings').eq('id',row.organization_id).single();const settings=org?.settings.byOperation?.[row.operation]||org?.settings;if(!settings)continue;
  const elapsed=(Date.now()-new Date(lead.lastInboundAt||lead.updated).getTime())/60000,index=(settings.followups||[]).findIndex((delay:number)=>elapsed>=delay&&!(lead.followupSent||[]).includes(delay));if(index<0)continue;
  const delay=settings.followups[index],eventId=`followup:${lead.id}:${lead.lastInboundAt||lead.updated}:${delay}`;
  const {error:claimError}=await db.from('integration_events').insert({id:eventId,organization_id:row.organization_id,event_type:'followup',payload:{leadId:lead.id,delay}});if(claimError)continue;
  try{if(elapsed<1440){const text=settings.followupText.replaceAll('{nome}',lead.name.split(' ')[0]);await sendWhatsApp(row.operation,lead.phone,text);lead.messages.push({id:crypto.randomUUID(),from:'bot',text,time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})});sent++;}
   else {const id=crypto.randomUUID();await db.from('tasks').insert({id,organization_id:row.organization_id,operation:row.operation,assigned_to:lead.agent,data:{id,leadId:lead.id,operation:row.operation,title:'Follow-up: preparar template aprovado',agent:lead.agent,due:new Date().toISOString(),priority:'Alta',done:false}});queued++;}
   lead.followupSent=[...(lead.followupSent||[]),delay];await db.from('leads').update({data:lead,updated_at:new Date().toISOString()}).eq('id',lead.id);await db.from('integration_events').update({processed:true}).eq('id',eventId);
  }catch{await db.from('integration_events').delete().eq('id',eventId);}
 }
 return new Response(JSON.stringify({sent,queued}),{headers:{'Content-Type':'application/json'}});
});
