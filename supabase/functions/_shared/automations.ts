import {sendWhatsApp} from './client.ts';
// Server execution of the same SE / delay / ENTÃO rules edited in the CRM.
export async function runAutomations(db:ReturnType<typeof import('./client.ts').admin>,row:{id:string;organization_id:string;operation:string;data:Record<string,any>}){
 const l=row.data,{data:rules}=await db.from('automations').select('data').eq('organization_id',row.organization_id).eq('operation',row.operation);
 for(const {data:r} of rules||[]){if(!r.active)continue;let triggerTime=l.created;let applies=false;
  if(r.trigger==='Lead entrou')applies=true;
  if(r.trigger==='Score acima de 70'){applies=l.score>70;triggerTime=l.updated;}
  if(r.trigger==='Sem resposta'){applies=l.status==='Aguardando resposta';triggerTime=l.lastInboundAt||l.updated;}
  if(r.trigger==='Proposta criada'){applies=l.proposals.length>0;triggerTime=l.proposals.at(-1)?.date||l.updated;}
  if(!applies||Date.now()-new Date(triggerTime).getTime()<r.delay*60000)continue;
  const cycle=r.trigger==='Sem resposta'?l.lastInboundAt||l.created:r.trigger==='Proposta criada'?l.proposals.at(-1).id:'once';const key=`automation:${r.id}:${l.id}:${cycle}`;
  const {error:claim}=await db.from('integration_events').insert({id:key,organization_id:row.organization_id,event_type:'automation',payload:{ruleId:r.id,leadId:l.id}});if(claim)continue;
  try{const text=r.message.replaceAll('{nome}',l.name.split(' ')[0]);
   if(r.action==='Enviar para fila')l.status='Fila';
   if(r.action==='Criar tarefa'||(r.action==='Enviar mensagem'&&(!l.lastInboundAt||Date.now()-new Date(l.lastInboundAt).getTime()>864e5))){const id=crypto.randomUUID();const {error}=await db.from('tasks').insert({id,organization_id:row.organization_id,operation:row.operation,assigned_to:l.agent,data:{id,leadId:l.id,operation:row.operation,title:'Automação: '+r.name,agent:l.agent,due:new Date().toISOString(),priority:'Média',done:false}});if(error)throw error;}
   else if(r.action==='Enviar mensagem'){await sendWhatsApp(row.operation,l.phone,text);l.messages.push({id:crypto.randomUUID(),from:'bot',text,time:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})});}
   l.activities.push({id:crypto.randomUUID(),text:'Automação executada: '+r.name,time:new Date().toISOString(),by:'Sistema'});
   const {error}=await db.from('leads').update({data:l,updated_at:new Date().toISOString()}).eq('id',row.id);if(error)throw error;
   await db.from('integration_events').update({processed:true}).eq('id',key);
  }catch{await db.from('integration_events').delete().eq('id',key);}
 }
}
