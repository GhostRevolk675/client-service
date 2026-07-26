/**
 * Ephemeral Chat - Configuração
 * 
 * SERVER_URL: Coloque aqui o endereço do seu servidor online.
 * Depois de fazer deploy no Render, substitua pelo URL que ele te dá.
 * Exemplo: 'https://ephemeral-chat.onrender.com'
 */

const APP_CONFIG = {
  // ⚠️ ALTERE ESTA URL após fazer deploy no Render:
  SERVER_URL: 'https://client-service-r1al.onrender.com',

  // Tempo de vida das mensagens (deve ser igual ao servidor)
  MESSAGE_TTL: 3000,

  // Nome do app
  APP_NAME: 'Ephemeral Chat',

  // Versão
  VERSION: '2.0.0'
};

/**
 * Detecta se está rodando dentro do Capacitor (Android/iOS)
 */
function isNativeApp() {
  return window.Capacitor !== undefined;
}

/**
 * Retorna a URL do servidor para conexão
 */
function getServerUrl() {
  if (APP_CONFIG.SERVER_URL) {
    return APP_CONFIG.SERVER_URL;
  }

  // Se estiver no app nativo sem URL configurado
  if (isNativeApp()) {
    console.warn('[Ephemeral] SERVER_URL não configurado. Configure em config.js.');
    return null;
  }

  // Na web, usa a mesma origem (funciona quando servidor e site são o mesmo)
  return undefined;
}
