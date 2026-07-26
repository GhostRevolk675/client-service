/**
 * Ephemeral Chat - Configuração
 * 
 * Define o endereço do servidor para conexão Socket.IO.
 * No navegador web, usa a mesma origem (window.location).
 * No app Android (Capacitor), deve apontar para o IP do servidor.
 * 
 * IMPORTANTE: Altere SERVER_URL para o IP da máquina que roda o servidor
 * quando usar o aplicativo Android.
 */

const APP_CONFIG = {
  // URL do servidor - altere para o IP da sua máquina na rede local
  // Exemplos:
  //   'http://192.168.1.100:3000'  (rede local)
  //   'https://meu-servidor.com'    (servidor remoto)
  //   null                          (usar mesma origem - web apenas)
  SERVER_URL: 'http://172.20.0.10:3000',

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
 * Se estiver no app nativo e SERVER_URL não estiver configurado,
 * usa o IP padrão da rede local
 */
function getServerUrl() {
  if (APP_CONFIG.SERVER_URL) {
    return APP_CONFIG.SERVER_URL;
  }

  // Se estiver no app nativo, precisamos de uma URL explícita
  if (isNativeApp()) {
    // Tenta usar o IP configurado, senão mostra aviso
    console.warn('[Ephemeral] App nativo detectado sem SERVER_URL configurado.');
    console.warn('[Ephemeral] Configure APP_CONFIG.SERVER_URL em config.js');
    // Fallback para localhost (funciona apenas em emuladores Android)
    return 'http://10.0.2.2:3000';
  }

  // Na web, usa a mesma origem
  return undefined;
}
