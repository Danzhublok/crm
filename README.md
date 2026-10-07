# Nexus CRM · AUREON e GR-INVEST

Central comercial em React, TypeScript, TailwindCSS, Recharts e Lucide React. O frontend entregue inicia em **modo demonstração**, com dados fictícios no armazenamento do navegador. A migração e as Edge Functions Supabase são entregues em código; não foram executadas em um projeto real porque não foram fornecidas credenciais.

**Apresentação:** abra `demo/APRESENTAR-CRM.html` diretamente no navegador. O arquivo inclui a aplicação e as logos. Para abrir no Windows, extraia a pasta inteira do ZIP e clique em `INICIAR.cmd`. Com Node.js instalado, ele inicia o servidor local e utiliza a demonstracao incluida quando nao ha `dist/`; sem Node.js, abre o HTML diretamente. Nao precisa instalar dependencias ou compilar para apresentar. Para gerar uma versao conectada com as suas variaveis de ambiente, execute `npm ci` e `npm run build`. Acesse `http://127.0.0.1:4173`. Não há uma hospedagem de produção configurada neste repositório.

## O que está disponível

**Visual atualizado:** tema azul e branco em todos os módulos, navegação mais compacta e foco no atendimento. A conversa usa toda a largura disponível ao lado da lista de contatos; o perfil do cliente abre pelo botão de informações no cabeçalho. Mensagens de 15 px, balões maiores, respostas em azul, texto de entrada ampliado e barras superiores reduzidas liberam espaço para as conversas.

- Atendimento com lista de conversas, chat amplo e perfil lateral sob demanda, busca por contato/CPF, filtros por status, origem visual e temperatura; operações AUREON, GR-INVEST e visão consolidada.
- Conversa local, anexos de até 10 MB, áudio com permissão do microfone, emojis, respostas rápidas, templates, transferência, etiquetas e encerramento.
- Cadastro/edição de leads, qualificação com regras de score, handoff, perfil completo com nove abas e histórico.
- Funil com dez etapas; arrastar cards no desktop ou usar o botão de mover etapa no celular.
- Tarefas vinculadas a leads, prioridade, responsável, vencimento e conclusão; agenda em dia, semana e mês.
- Propostas com condições informadas pelo usuário, status, download de texto e preparação de mensagem de envio. O produto não calcula aprovação, taxas ou contemplação.
- Dashboard com gráficos e métricas calculados a partir dos registros; campanhas, equipe, distribuição, ranking, relatórios e exportação CSV.
- Chatbot de pré-qualificação testável, editor de saudação e limiar de handoff; configuração independente por operação.
- Editor e teste de regras; cadência de follow-ups; metas, permissões, auditoria e backup JSON.
- Assistente contextual local por regras. Quando conectado, utiliza a função `crm-ai` e a Responses API com chave no servidor.

## Executar localmente

```sh
npm install
npm run dev
npm run build
```

O build gera `dist/`. `resolve.preserveSymlinks` está habilitado para compatibilidade com o ambiente Windows com sandbox. Para servir o build local, execute `node serve.mjs`.

## Conectar Supabase

1. Crie um projeto Supabase e execute `supabase/migration.sql` uma vez no SQL Editor.
2. Copie `.env.example` para `.env.local` e preencha a URL e a chave **anon/publicável**. Nunca use `service_role` no frontend.
3. Cadastre o primeiro usuário no Supabase Auth. Para criar seu workspace, execute `create_workspace` autenticado, pelo cliente Supabase:

```ts
await supabase.auth.signInWithPassword({ email, password });
await supabase.rpc('create_workspace', {
  workspace_name: 'Grupo Aureon', display_name: 'Nome do administrador'
});
```

4. Crie os demais usuários no Auth. Insira seus registros na tabela `users` pelo SQL Editor ou por um backend administrativo. Use o UUID real do Auth, o mesmo `organization_id`, a função e o array de operações permitidas.
5. Para atendentes, o `name` de `users` deve coincidir com o nome no cadastro comercial da equipe. Cadastre nomes únicos no workspace. A permissão de lead é aplicada no banco; o perfil não pode ser alterado pelo cliente.
6. Recompile o frontend e entre usando o botão de conta. O workspace real começa vazio; os exemplos da demonstração não são importados automaticamente.

O banco aplica RLS por organização, operação e responsável. As funções `crm_load` e `crm_save` rodam com os privilégios do usuário. O salvamento envia somente registros alterados, verifica a versão anterior e recusa conflitos; uma edição conflitante requer recarregar a página. `users` e `audit_logs` não têm escrita concedida ao cliente. Mensagens, propostas, documentos, atividades e etiquetas são espelhados atomicamente do agregado do lead em tabelas relacionadas.

## WhatsApp e IA

Publique as funções na pasta `supabase/functions` no seu projeto. Configure secrets no servidor:

| Secret | Uso |
|---|---|
| `OPENAI_API_KEY` | Chave do provedor de IA |
| `OPENAI_MODEL` | Modelo habilitado na sua conta |
| `WHATSAPP_TOKEN_AUREON` / `WHATSAPP_TOKEN_GR_INVEST` | Tokens oficiais do canal |
| `WHATSAPP_PHONE_ID_AUREON` / `WHATSAPP_PHONE_ID_GR_INVEST` | IDs dos números comerciais |
| `META_GRAPH_VERSION` | Versão suportada da Graph API no seu aplicativo |
| `META_APP_SECRET` | Validação HMAC do webhook |
| `META_VERIFY_TOKEN` | Verificação inicial do webhook |
| `WHATSAPP_ROUTES` | JSON que associa cada phone ID à operação e ao UUID da organização |
| `CRON_SECRET` | Segredo para o processamento agendado |

Exemplo estrutural de `WHATSAPP_ROUTES` (substitua pelos IDs reais):

```json
{"phone-id-aureon":{"organization_id":"uuid-da-organizacao","operation":"AUREON"},"phone-id-gr":{"organization_id":"uuid-da-organizacao","operation":"GR-INVEST"}}
```

Os secrets padrão `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são usados apenas pelas funções do servidor. `crm-ai` e `whatsapp-send` verificam o token do usuário com `getUser` e consultam leads com RLS. O webhook autentica a assinatura Meta. Eventos são deduplicados por ID, e follow-ups têm uma chave idempotente por lead/intervalo.

Configure o endereço da função `whatsapp-webhook` no aplicativo Meta e assine o evento `messages`. O exemplo trata texto recebido e indica outros tipos de mídia; a importação automática do binário de mídia e recibos de leitura ainda precisa ser adicionada antes do uso produtivo. Envio de anexos usa uma URL assinada do bucket privado.

Agende `process-followups` no servidor via pg_cron/pg_net ou scheduler externo, enviando `x-cron-secret`. O exemplo processa até 500 leads por execução; implemente paginação para volumes maiores. Dentro de 24 horas prepara o envio de texto; fora desse intervalo cria tarefa para usar um template aprovado. O código não envia templates ainda. Valide as políticas atuais do canal antes da ativação. As automações configuradas na UI possuem execução local de teste e são processadas pelo motor de regras do servidor quando o agendador é conectado. O webhook implementa o fluxo específico de pré-qualificação.

## Limites e validação

- **Build, TypeScript, renderização React no servidor, integridade dos dados fictícios, limites de score e isolamento das configurações verificados.** A sintaxe das funções de servidor foi verificada. O teste visual/interativo no navegador e a conexão à prévia local foram bloqueados pela infraestrutura disponível.
- Supabase, RLS, Edge Functions, webhooks e envio externo **não foram validados em ambiente conectado**. Execute testes de integração e concorrência antes de operar com dados reais.
- A demo grava metadados no localStorage. URLs de anexos locais funcionam apenas na sessão que criou o arquivo; os binários não são incluídos no backup. No modo conectado, os arquivos são enviados para Storage privado.
- O score é uma regra comercial explicável, e não uma probabilidade estatística de conversão. Os indicadores de tempo de resposta dos exemplos são demonstrativos.
- Metas configuradas por operação e visão consolidada são independentes. A meta consolidada não é somada automaticamente das metas das operações.
- O armazenamento de mensagens no agregado do lead simplifica a primeira versão. Para alto volume, migre as escritas para mensagens independentes, outbox transacional, paginação, retenção e ingestão de mídia com fila. O webhook e follow-up de exemplo devem passar por testes de reentrega e concorrência.
- Sem credenciais externas, nenhuma mensagem comercial é enviada. A interface informa o modo demonstração.

## Referências de implementação

[Supabase Auth](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [Realtime](https://supabase.com/docs/guides/realtime/postgres-changes), [autenticação de Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [verificação de webhook WhatsApp](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/).


## Tema e fotos dos clientes

O botão de lua/sol no topo alterna os modos claro e escuro, salvando a preferência neste navegador. As logos originais de Aureon e Grupo Invest estão incluídas no código.

O campo opcional `photoUrl` permite exibir uma foto HTTPS recebida de uma integração. Sem imagem, ou em caso de falha, o CRM mostra as iniciais. A sincronização automática das fotos do WhatsApp ainda depende do provedor conectado e não está implementada nesta demonstração.

O arquivo `nexus-backup.json` existente no repositório foi preservado.
