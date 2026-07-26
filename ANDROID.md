# Ephemeral Chat - Build Android (APK)

Guia completo para gerar o APK instalável no Android.

---

## Pré-requisitos

Antes de gerar o APK, você precisa instalar:

### 1. Java Development Kit (JDK 17)

Baixe e instale o JDK 17:
- **Windows**: https://adoptium.net/temurin/releases/?version=17
- Após instalar, configure a variável de ambiente:
  ```
  JAVA_HOME = C:\Program Files\Eclipse Adoptium\jdk-17.x.x
  ```

### 2. Android SDK (via Android Studio ou Command Line Tools)

**Opção A - Android Studio (recomendado para iniciantes):**
1. Baixe: https://developer.android.com/studio
2. Instale e abra o Android Studio
3. Vá em `Tools > SDK Manager`
4. Instale o **Android SDK 33** (ou superior)
5. Em "SDK Tools", marque:
   - Android SDK Build-Tools
   - Android SDK Command-line Tools
   - Android SDK Platform-Tools

**Opção B - Apenas Command Line Tools (sem IDE):**
1. Baixe: https://developer.android.com/studio#command-tools
2. Extraia em `C:\Android\cmdline-tools\latest\`
3. Execute:
   ```bash
   sdkmanager "platforms;android-33" "build-tools;33.0.2" "platform-tools"
   ```

### 3. Variáveis de Ambiente

Adicione ao PATH do sistema:

```
ANDROID_HOME = C:\Users\SeuUsuario\AppData\Local\Android\Sdk
    (ou onde o SDK foi instalado)

PATH += %ANDROID_HOME%\platform-tools
PATH += %ANDROID_HOME%\tools
```

### 4. Node.js (já instalado)

- Node.js 16+ (já utilizado para o servidor)

---

## Gerar o APK

### Passo 1: Configurar o servidor

Antes de gerar o APK, edite o arquivo `public/config.js` e configure o IP do servidor:

```javascript
const APP_CONFIG = {
  // Coloque o IP da máquina que roda o servidor na rede local
  SERVER_URL: 'http://192.168.1.100:3000',  // ← ALTERE AQUI
  ...
};
```

> **Como descobrir o IP:**
> - Windows: abra o cmd e digite `ipconfig` → procure "Endereço IPv4"
> - O celular e o servidor devem estar na mesma rede Wi-Fi

### Passo 2: Build dos arquivos web

```bash
cd ephemeral-chat
npm run build:web
```

Isso copia os arquivos de `public/` para `www/` e injeta o Capacitor.

### Passo 3: Sincronizar com o Android

```bash
npx cap sync android
```

### Passo 4: Gerar o APK de Debug

**Opção A - Via Gradle (linha de comando):**

```bash
cd android
gradlew.bat assembleDebug
```

> No Linux/Mac: `./gradlew assembleDebug`

O APK será gerado em:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

**Opção B - Via Android Studio:**

1. Execute:
   ```bash
   npx cap open android
   ```
2. No Android Studio, aguarde o Gradle sincronizar
3. Menu: `Build > Build Bundle(s) / APK(s) > Build APK(s)`
4. Clique em "Locate" quando terminar para encontrar o APK

### Passo 5: Instalar no celular

**Via USB:**
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

**Via arquivo:**
1. Copie o `app-debug.apk` para o celular (USB, e-mail, Drive, etc.)
2. No celular, toque no arquivo APK
3. Permita "Instalar de fontes desconhecidas" se solicitado
4. Instale e abra o app

---

## Gerar APK de Release (Produção)

Para distribuir o app, gere uma versão assinada:

### 1. Criar keystore

```bash
keytool -genkey -v -keystore ephemeral-chat.keystore -alias ephemeral -keyalg RSA -keysize 2048 -validity 10000
```

### 2. Configurar signing no Gradle

Edite `android/app/build.gradle` e adicione dentro de `android {}`:

```groovy
signingConfigs {
    release {
        storeFile file('../../ephemeral-chat.keystore')
        storePassword 'SUA_SENHA'
        keyAlias 'ephemeral'
        keyPassword 'SUA_SENHA'
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

### 3. Gerar APK de release

```bash
cd android
gradlew.bat assembleRelease
```

APK gerado em:
```
android/app/build/outputs/apk/release/app-release.apk
```

---

## Comando Rápido (tudo de uma vez)

```bash
# Na pasta ephemeral-chat/
npm run build:android
cd android
gradlew.bat assembleDebug
```

Ou em um único comando PowerShell:
```powershell
npm run build:web; npx cap sync android; Push-Location android; .\gradlew.bat assembleDebug; Pop-Location
```

---

## Executar o Servidor

O servidor precisa estar rodando para o app funcionar:

```bash
# Em um terminal separado, na pasta ephemeral-chat/
npm start
```

O servidor roda em `http://seu-ip:3000`. O celular e o computador devem estar na mesma rede.

---

## Testar no Emulador

Se preferir testar sem celular físico:

1. Abra o Android Studio
2. `Tools > Device Manager > Create Device`
3. Escolha um dispositivo (ex: Pixel 6)
4. Baixe uma imagem de sistema (API 33+)
5. Inicie o emulador
6. Execute:
   ```bash
   npx cap run android
   ```

> No emulador, o `config.js` pode usar `http://10.0.2.2:3000` (redireciona para localhost da máquina host)

---

## Estrutura do Projeto Android

```
ephemeral-chat/
├── android/                          # Projeto Android nativo
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml   # Permissões e configuração
│   │   │   ├── java/.../MainActivity.java
│   │   │   ├── assets/public/        # Web assets (gerados pelo sync)
│   │   │   └── res/
│   │   │       ├── drawable/         # Ícones e splash
│   │   │       ├── values/           # Cores, strings, estilos
│   │   │       └── xml/              # Network security config
│   │   └── build.gradle
│   └── gradlew.bat                   # Build tool
├── public/                           # Código fonte web
├── www/                              # Build web (gerado)
├── scripts/build.js                  # Script de build
├── capacitor.config.json             # Config do Capacitor
├── server.js                         # Servidor Node.js
└── package.json
```

---

## Solução de Problemas

| Problema | Solução |
|----------|---------|
| "JAVA_HOME not set" | Instale o JDK 17 e configure a variável JAVA_HOME |
| "SDK location not found" | Crie o arquivo `android/local.properties` com: `sdk.dir=C:\\Users\\SeuUsuario\\AppData\\Local\\Android\\Sdk` |
| "Connection refused" no app | Verifique se o SERVER_URL em config.js está correto e o servidor está rodando |
| App não conecta ao servidor | Celular e servidor devem estar na mesma rede Wi-Fi |
| "cleartext traffic not permitted" | O network_security_config.xml já está configurado; rode `npx cap sync android` novamente |
| Gradle muito lento | A primeira build baixa dependências (~500MB); builds seguintes são rápidos |

---

## Resumo dos Comandos

```bash
# Instalar dependências (primeira vez)
npm install

# Iniciar servidor
npm start

# Build para Android
npm run build:web
npx cap sync android

# Gerar APK
cd android && gradlew.bat assembleDebug

# Abrir no Android Studio
npx cap open android
```
