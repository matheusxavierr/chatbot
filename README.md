# Chatbot whatsapp

Bot de atendimento para WhatsApp usando `whatsapp-web.js` com fluxos reais de atendimento:

- Menu principal com opcoes de suporte.
- FAQ com respostas rapidas.
- Fila para atendimento humano.
- Abertura de solicitacao com protocolo.
- Comandos de navegacao (`menu`, `voltar`, `sair`).
- Resposta para mensagens com midia sem contexto.
- Guardrails de seguranca (anti-spam, limite de tentativas e bloqueio temporario).

## Como rodar

1. Entre na pasta do projeto.
2. Instale as dependencias:

```bash
npm install
```

3. Execute o bot:

```bash
node chatbot.js
```

4. Escaneie o QR code no terminal.

## Variaveis de ambiente (opcional)

- `HEADLESS=true` para rodar sem abrir janela do navegador.
- `ADMIN_NUMBER=5511999999999` para receber aviso quando alguem pedir atendente humano.

Exemplo no PowerShell:

```powershell
$env:HEADLESS="true"
$env:ADMIN_NUMBER="5511999999999"
node chatbot.js
```

## Fluxo principal

- `1`: encaminha para fila de atendente humano.
- `2`: informa horario e status (aberto/fechado).
- `3`: envia endereco + link do Maps.
- `4`: abre FAQ (opcoes `a`, `b`, `c`).
- `5`: abre solicitacao e gera protocolo.

## Observacoes

- O bot ignora mensagens de grupos.
- Sessao do WhatsApp e mantida localmente pelo `LocalAuth`.
- Estados de conversa inativos sao limpos automaticamente.
- Guardrails ativos:
  - Limite de tamanho por mensagem (600 caracteres).
  - Anti-spam por janela curta de tempo.
  - Pausa temporaria por linguagem abusiva.
  - Aviso para termos sensiveis (senha, CVV, token, cartao).
  - Bloqueio temporario apos muitas tentativas invalidas seguidas.
