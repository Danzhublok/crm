import {caller,cors,json,sendWhatsApp} from '../_shared/client.ts';
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Método inválido'},405);try{
 const {db}=await caller(req),body=await req.json();if(typeof body.text!=='string'||body.text.length>4096)throw new Error('Mensagem inválida ou acima de 4096 caracteres.');
 const {data:lead,error}=await db.from('leads').select('*').eq('id',body.leadId).single();if(error||!lead)return json({error:'Lead indisponível para este usuário'},403);
 let attachment;if(body.attachment){const path=String(body.attachment.url);const {data,error}=await db.storage.from('documents').createSignedUrl(path,120);if(error||!data)throw new Error('Sem acesso ao anexo');attachment={url:data.signedUrl,type:String(body.attachment.type),name:String(body.attachment.name)};}
 const result=await sendWhatsApp(lead.operation,lead.data.phone,body.text,attachment);return json({ok:true,messageId:result.messages?.[0]?.id});
 }catch(e){return json({error:e instanceof Error?e.message:'Falha no envio'},400);}});
