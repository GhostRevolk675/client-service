# Ephemeral Chat

Aplicativo de mensagens efêmeras com foco em privacidade. As mensagens desaparecem automaticamente após **3 segundos**, sem possibilidade de recuperação.

## Funcionalidades

- Mensagens em tempo real via WebSocket (Socket.IO)
- Mensagens expiram em 3 segundos e são removidas do servidor permanentemente
- Timer visual com contagem regressiva em cada mensagem
- Barra de progresso animada mostrando o tempo restante
- Indicador "digitando..." em tempo real
- Status online/offline dos participantes
- Confirmação de entrega (✓✓)
- Animações suaves de entrada e saída
- Notificações do navegador para mensagens recebidas
- Tema escuro moderno e responsivo

## Estrutura do Projeto

```
ephemeral-chat/
├── server.js              # Servidor Node.js + Express + Socket.IO
├── package.json           # Dependências e scripts
├── README.md              # Este arquivo
└── public/                # Frontend (servido como estático)
    ├── index.html         # Estrutura HTML (3 telas)
    ├── styles.css         # Estilos - tema escuro com animações
    └── app.js             # Lógica do cliente Socket.IO
```

## Pré-requisitos

- [Node.js](https://nodejs.org/) versão 16 ou superior
- npm (incluído com Node.js)

## Instalação

```bash
# 1. Entrar na pasta do projeto
cd ephemeral-chat

# 2. Instalar dependências
npm install
```

## Execução

```bash
# Modo produção
npm start

# Modo desenvolvimento (com auto-reload via nodemon)
npm run dev
```

O servidor inicia em **http://localhost:3000**.

## Como Usar

1. Abra **http://localhost:3000** em um navegador.
2. Digite um nome e clique em "Entrar".
3. Toque no contato disponível para abrir a conversa.
4. Digite uma mensagem e envie.
5. A mensagem aparece para ambos os participantes e desaparece em 3 segundos.

### Testar com dois usuários

Abra duas abas (ou dois navegadores) em `http://localhost:3000`. Faça login com nomes diferentes em cada aba e converse em tempo real.

## Configuração

No arquivo `server.js`, é possível ajustar:

```javascript
const PORT = process.env.PORT || 3000;  // Porta do servidor
const MESSAGE_TTL = 3000;               // Tempo de vida das mensagens (ms)
```

## Tecnologias

| Camada    | Tecnologia          |
|-----------|---------------------|
| Backend   | Node.js + Express   |
| WebSocket | Socket.IO 4.7       |
| Frontend  | HTML/CSS/JS puro    |
| Fonte     | Inter (Google Fonts)|

## Segurança e Privacidade

- As mensagens são armazenadas **apenas em memória** (Map do JS).
- Após 3 segundos, a mensagem é deletada do servidor e não pode ser recuperada.
- Não há banco de dados, logs de mensagens ou persistência.
- Se o servidor reiniciar, todas as mensagens são perdidas.

## Roadmap (expansões possíveis)

- [ ] Autenticação por e-mail (JWT)
- [ ] Criptografia ponta a ponta (E2EE com Web Crypto API)
- [ ] Salas privadas com código de acesso
- [ ] Mensagens de áudio efêmeras
- [ ] Deploy com Docker

## Licença

MIT
