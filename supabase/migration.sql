-- Nexus CRM / PostgreSQL 15+ / execute uma vez no SQL Editor do Supabase.
-- Não contém credenciais nem dados fictícios de clientes.
begin;
create extension if not exists pgcrypto;
create table public.organizations(id uuid primary key default gen_random_uuid(),name text not null,settings jsonb not null default '{"monthlyGoal":3000000,"distribution":"Round Robin","botActive":true,"handoff":70,"botGreeting":"Olá! Sou o Assistente Comercial. Qual seu nome?","followups":[30,1440,4320,10080,21600],"followupText":"Olá {nome}, conseguiu analisar a simulação?"}',created_at timestamptz default now());
create table public.users(id uuid primary key references auth.users(id) on delete cascade,organization_id uuid not null references organizations(id),name text not null,role text not null check(role in ('Administrador','Gestor','Supervisor','Atendente')),operations text[] not null default array['AUREON','GR-INVEST']);
create table public.operations(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id),name text not null check(name in ('AUREON','GR-INVEST')),settings jsonb not null default '{}',unique(organization_id,name));
create table public.leads(id text primary key,organization_id uuid not null references organizations(id),operation text not null check(operation in ('AUREON','GR-INVEST')),assigned_to text not null,data jsonb not null,updated_at timestamptz not null default now(),foreign key(organization_id,operation) references operations(organization_id,name),check(data->>'id'=id),check(data->>'operation'=operation),check(data->>'agent'=assigned_to));
create index leads_scope on public.leads(organization_id,operation,assigned_to);
create index leads_updated on public.leads(updated_at);
alter table leads add column phone_normalized text generated always as (regexp_replace(data->>'phone','[^0-9]','','g')) stored;
create index leads_phone on leads(organization_id,operation,phone_normalized);
create table public.integration_events(id text primary key,organization_id uuid references organizations(id),event_type text not null,payload jsonb not null,processed boolean default false,created_at timestamptz default now());
alter table integration_events enable row level security;

-- Indexed envelopes preserve evolving product fields without schema drift.
-- Authentication identities are separate from commercial team records.
do $$ declare t text; begin
 foreach t in array array['tasks','appointments','attendants','automations','campaigns'] loop
  execute format('create table public.%I(id text primary key,organization_id uuid not null references public.organizations(id),operation text not null check(operation in (''AUREON'',''GR-INVEST'')),assigned_to text not null default '''',data jsonb not null,updated_at timestamptz not null default now(),foreign key(organization_id,operation) references public.operations(organization_id,name),check(data->>''id''=id),check(data->>''operation''=operation))',t);
  execute format('create index on public.%I(organization_id,operation)',t);
 end loop;
end $$;

create table public.conversations(id text primary key references leads(id) on delete cascade,lead_id text not null references leads(id) on delete cascade,status text not null);
create table public.messages(id text primary key,lead_id text not null references leads(id) on delete cascade,data jsonb not null);
create table public.proposals(id text primary key,lead_id text not null references leads(id) on delete cascade,data jsonb not null);
create table public.documents(id text primary key,lead_id text not null references leads(id) on delete cascade,data jsonb not null);
create table public.activities(id text primary key,lead_id text not null references leads(id) on delete cascade,data jsonb not null);
create table public.tags(organization_id uuid references organizations(id),name text not null,primary key(organization_id,name));
create table public.lead_tags(lead_id text references leads(id) on delete cascade,organization_id uuid,name text,primary key(lead_id,name),foreign key(organization_id,name) references tags(organization_id,name));
create table public.lead_sources(organization_id uuid references organizations(id),name text not null,primary key(organization_id,name));
create table public.pipelines(id uuid primary key default gen_random_uuid(),operation_id uuid references operations(id),name text not null);
create table public.pipeline_stages(id uuid primary key default gen_random_uuid(),pipeline_id uuid references pipelines(id),name text not null,position integer not null);
create table public.automation_steps(id uuid primary key default gen_random_uuid(),automation_id text references automations(id) on delete cascade,position integer not null,data jsonb not null);
create table public.chatbot_flows(id uuid primary key default gen_random_uuid(),operation_id uuid references operations(id),data jsonb not null);
create table public.followups(id uuid primary key default gen_random_uuid(),lead_id text references leads(id) on delete cascade,due_at timestamptz not null,status text default 'pending',data jsonb not null default '{}');
create table public.audit_logs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references organizations(id),actor_id uuid references auth.users(id),record_id text,action text not null,old_data jsonb,new_data jsonb,created_at timestamptz not null default now());

create or replace function public.my_profile() returns public.users language sql stable security definer set search_path=public,pg_temp as $$ select u from public.users u where id=auth.uid() $$;
create or replace function public.crm_can_read(org uuid,op text,owner_name text default null) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from users u where u.id=auth.uid() and u.organization_id=org and op=any(u.operations) and (owner_name is null or u.role<>'Atendente' or u.name=owner_name)) $$;
create or replace function public.crm_manager(org uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select exists(select 1 from users u where u.id=auth.uid() and u.organization_id=org and u.role in ('Administrador','Gestor')) $$;
alter table organizations enable row level security;
alter table users enable row level security;
alter table operations enable row level security;
alter table leads enable row level security;
alter table audit_logs enable row level security;
create policy self_profile on users for select to authenticated using(id=auth.uid());
create policy org_read on organizations for select to authenticated using(id=(my_profile()).organization_id);
create policy org_update on organizations for update to authenticated using(crm_manager(id)) with check(crm_manager(id));
create policy operation_read on operations for select to authenticated using(crm_can_read(organization_id,name));
create policy operation_update on operations for update to authenticated using(crm_manager(organization_id)) with check(crm_manager(organization_id));
create policy lead_read on leads for select to authenticated using(crm_can_read(organization_id,operation,assigned_to));
create policy lead_create on leads for insert to authenticated with check(crm_can_read(organization_id,operation,assigned_to));
create policy lead_update on leads for update to authenticated using(crm_can_read(organization_id,operation,assigned_to)) with check(crm_can_read(organization_id,operation,assigned_to));
create policy lead_delete on leads for delete to authenticated using(crm_manager(organization_id));
create policy audit_read on audit_logs for select to authenticated using(crm_manager(organization_id));
do $$ declare t text; owner_expr text; begin
 foreach t in array array['tasks','appointments','attendants','automations','campaigns'] loop
  execute format('alter table public.%I enable row level security',t);
  owner_expr:=case when t in ('tasks','appointments') then 'assigned_to' else 'null' end;
  execute format('create policy resource_read on public.%I for select to authenticated using(public.crm_can_read(organization_id,operation,%s))',t,owner_expr);
  if t in ('tasks','appointments') then
   execute format('create policy resource_create on public.%I for insert to authenticated with check(public.crm_can_read(organization_id,operation,assigned_to))',t);
   execute format('create policy resource_update on public.%I for update to authenticated using(public.crm_can_read(organization_id,operation,assigned_to)) with check(public.crm_can_read(organization_id,operation,assigned_to))',t);
   execute format('create policy resource_delete on public.%I for delete to authenticated using(public.crm_can_read(organization_id,operation,assigned_to))',t);
  else
   execute format('create policy resource_create on public.%I for insert to authenticated with check(public.crm_manager(organization_id) and public.crm_can_read(organization_id,operation))',t);
   execute format('create policy resource_update on public.%I for update to authenticated using(public.crm_manager(organization_id)) with check(public.crm_manager(organization_id) and public.crm_can_read(organization_id,operation))',t);
   execute format('create policy resource_delete on public.%I for delete to authenticated using(public.crm_manager(organization_id))',t);
  end if;
 end loop;
 foreach t in array array['conversations','messages','proposals','documents','activities','lead_tags','followups'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy child_read on public.%I for select to authenticated using(exists(select 1 from public.leads l where l.id=lead_id))',t);
 end loop;
 foreach t in array array['tags','lead_sources'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy lookup_read on public.%I for select to authenticated using(organization_id=(public.my_profile()).organization_id)',t);
 end loop;
 foreach t in array array['pipelines','pipeline_stages','automation_steps','chatbot_flows'] loop
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;

-- Mirror lead aggregate into normalized child tables atomically.
create or replace function public.crm_mirror_lead() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare item jsonb; pos integer; t text; column_name text; begin
 insert into conversations(id,lead_id,status) values(new.id,new.id,new.data->>'status') on conflict(id) do update set status=excluded.status;
 foreach t in array array['messages','proposals','activities'] loop
  execute format('delete from public.%I where lead_id=$1',t) using new.id;
  for item in select value from jsonb_array_elements(coalesce(new.data->t,'[]'::jsonb)) loop
   execute format('insert into public.%I(id,lead_id,data) values($1,$2,$3)',t) using new.id||':'||(item->>'id'),new.id,item;
  end loop;
 end loop;
 delete from documents where lead_id=new.id;pos:=0;
 for item in select value from jsonb_array_elements(coalesce(new.data->'docs','[]'::jsonb)) loop
  insert into documents(id,lead_id,data) values(new.id||':doc:'||pos,new.id,item);pos:=pos+1;
 end loop;
 delete from lead_tags where lead_id=new.id;
 for item in select value from jsonb_array_elements(coalesce(new.data->'tags','[]'::jsonb)) loop
  insert into tags(organization_id,name) values(new.organization_id,item#>>'{}') on conflict do nothing;
  insert into lead_tags(lead_id,organization_id,name) values(new.id,new.organization_id,item#>>'{}') on conflict do nothing;
 end loop;
 insert into lead_sources(organization_id,name) values(new.organization_id,new.data->>'source') on conflict do nothing;
 return new;
end $$;
create trigger mirror_lead after insert or update on leads for each row execute function crm_mirror_lead();
create or replace function public.crm_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 insert into audit_logs(organization_id,actor_id,record_id,action,old_data,new_data) values(coalesce(new.organization_id,old.organization_id),auth.uid(),coalesce(new.id,old.id),tg_table_name||' · '||tg_op,case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
 return coalesce(new,old);
end $$;
do $$ declare t text; begin foreach t in array array['leads','tasks','appointments','attendants','automations','campaigns'] loop execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.crm_audit()',t);end loop;end $$;

create or replace function public.crm_load() returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb; p public.users; begin
 p:=my_profile();if p.id is null then raise exception 'Usuário sem perfil comercial. Solicite o cadastro ao administrador.';end if;
 select jsonb_build_object('leads',coalesce((select jsonb_agg(data order by updated_at desc) from leads),'[]'), 'tasks',coalesce((select jsonb_agg(data) from tasks),'[]'), 'appointments',coalesce((select jsonb_agg(data) from appointments),'[]'), 'team',coalesce((select jsonb_agg(data) from attendants),'[]'), 'rules',coalesce((select jsonb_agg(data) from automations),'[]'), 'campaigns',coalesce((select jsonb_agg(data) from campaigns),'[]'), 'settings',(select settings from organizations where id=p.organization_id),'audit',coalesce((select jsonb_agg(jsonb_build_object('id',id,'text',action||' · '||record_id,'by',coalesce(actor_id::text,'Sistema'),'time',created_at) order by created_at desc) from (select * from audit_logs order by created_at desc limit 100) recent),'[]')) into result;
 return result;
end $$;
create or replace function public.crm_save(payload jsonb) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.users;k text;t text;change jsonb;current_data jsonb;new_data jsonb;owner_name text;begin
 p:=my_profile();if p.id is null then raise exception 'Perfil obrigatório';end if;
 for k,t in select * from (values('leads','leads'),('tasks','tasks'),('appointments','appointments'),('team','attendants'),('rules','automations'),('campaigns','campaigns')) mapping(client_key,table_key) loop
  for change in select value from jsonb_array_elements(coalesce(payload->k,'[]'::jsonb)) loop
   execute format('select data from public.%I where id=$1 for update',t) into current_data using change->>'id';
   if current_data is distinct from nullif(change->'old','null'::jsonb) then raise exception 'Conflito de edição no registro %. Atualize a página antes de tentar novamente.',change->>'id';end if;
   new_data:=nullif(change->'data','null'::jsonb);
   if new_data is null then execute format('delete from public.%I where id=$1',t) using change->>'id';
   else
    owner_name:=coalesce(new_data->>'agent','');
    if t='leads' then
     insert into leads(id,organization_id,operation,assigned_to,data) values(change->>'id',p.organization_id,new_data->>'operation',owner_name,new_data) on conflict(id) do update set operation=excluded.operation,assigned_to=excluded.assigned_to,data=excluded.data,updated_at=now();
    else
     execute format('insert into public.%I(id,organization_id,operation,assigned_to,data) values($1,$2,$3,$4,$5) on conflict(id) do update set operation=excluded.operation,assigned_to=excluded.assigned_to,data=excluded.data,updated_at=now()',t) using change->>'id',p.organization_id,new_data->>'operation',owner_name,new_data;
    end if;
   end if;
  end loop;
 end loop;
 if payload ? 'settings' then
  select settings into current_data from organizations where id=p.organization_id for update;
  if current_data is distinct from payload->'settings'->'old' then raise exception 'Configurações alteradas por outro usuário. Atualize a página.';end if;
  update organizations set settings=payload->'settings'->'data' where id=p.organization_id;
  if not found then raise exception 'Sem permissão para alterar configurações';end if;
 end if;
end $$;

-- Explicit onboarding: run this as a signed-in user, never with an invented auth UUID.
create or replace function public.create_workspace(workspace_name text,display_name text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare org uuid;op uuid;p uuid;name text;pos int;begin
 if auth.uid() is null then raise exception 'Autenticação obrigatória';end if;
 if exists(select 1 from users where id=auth.uid()) then raise exception 'Usuário já possui um workspace';end if;
 insert into organizations(name) values(workspace_name) returning id into org;
 insert into users(id,organization_id,name,role) values(auth.uid(),org,display_name,'Administrador');
 foreach name in array array['AUREON','GR-INVEST'] loop
  insert into operations(organization_id,name) values(org,name) returning id into op;
  insert into pipelines(operation_id,name) values(op,'Funil comercial') returning id into p;pos:=0;
  foreach name in array array['Lead recebido','Contato realizado','Qualificação','Simulação','Proposta','Negociação','Documentação','Fechamento','Convertido','Perdido'] loop
   insert into pipeline_stages(pipeline_id,name,position) values(p,name,pos);pos:=pos+1;
  end loop;
 end loop;return org;
end $$;

-- Store only private objects; signed URLs expire and user-folder ownership is enforced.
insert into storage.buckets(id,name,public,file_size_limit) values('documents','documents',false,10485760) on conflict(id) do nothing;
create policy document_upload on storage.objects for insert to authenticated with check(bucket_id='documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy document_read on storage.objects for select to authenticated using(bucket_id='documents' and ((storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from public.documents d where d.data->>'url'=name)));
revoke all on function public.crm_load() from public,anon;
revoke all on function public.crm_save(jsonb) from public,anon;
revoke all on function public.create_workspace(text,text) from public,anon;
grant execute on function public.crm_load(), public.crm_save(jsonb),public.create_workspace(text,text) to authenticated;
grant select on all tables in schema public to authenticated;
grant insert,update,delete on leads,tasks,appointments,attendants,automations,campaigns to authenticated;
grant update on organizations,operations to authenticated;
-- No client grants for writing users, audit_logs, or mirrored child tables.
alter publication supabase_realtime add table public.leads;
commit;
