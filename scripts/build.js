/**
 * Build Script - Ephemeral Chat
 * 
 * Copia os arquivos do frontend (public/) para a pasta www/
 * que o Capacitor usa como webDir para o app nativo.
 * 
 * Também injeta o script do Capacitor no HTML.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '..', 'public');
const DEST_DIR = path.join(__dirname, '..', 'www');

// ============================================================
// Funções auxiliares
// ============================================================

/**
 * Cria diretório recursivamente se não existir
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Copia um arquivo de origem para destino
 */
function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

/**
 * Copia todos os arquivos de um diretório recursivamente
 */
function copyDir(src, dest) {
  ensureDir(dest);

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

/**
 * Injeta o script do Capacitor no index.html para o build nativo
 */
function injectCapacitorScript(htmlPath) {
  let html = fs.readFileSync(htmlPath, 'utf-8');

  // Adicionar viewport meta para mobile se não existir
  if (!html.includes('viewport-fit=cover')) {
    html = html.replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">'
    );
  }

  // Injetar Capacitor JS antes do fechamento do </head>
  if (!html.includes('capacitor.js')) {
    html = html.replace(
      '</head>',
      '  <!-- Capacitor Bridge -->\n  <script src="capacitor.js"></script>\n</head>'
    );
  }

  // Adicionar safe area padding para dispositivos com notch
  if (!html.includes('safe-area')) {
    const safeAreaCSS = `
  <style>
    /* Safe area para dispositivos Android com notch */
    body {
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    }
  </style>`;
    html = html.replace('</head>', `${safeAreaCSS}\n</head>`);
  }

  fs.writeFileSync(htmlPath, html, 'utf-8');
}

// ============================================================
// Execução do build
// ============================================================

console.log('╔══════════════════════════════════════════╗');
console.log('║   Ephemeral Chat - Build para Android    ║');
console.log('╚══════════════════════════════════════════╝');
console.log('');

// 1. Limpar pasta www
console.log('[1/4] Limpando pasta www/...');
if (fs.existsSync(DEST_DIR)) {
  fs.rmSync(DEST_DIR, { recursive: true, force: true });
}

// 2. Copiar arquivos do public/ para www/
console.log('[2/4] Copiando arquivos de public/ para www/...');
copyDir(SOURCE_DIR, DEST_DIR);

// 3. Injetar script do Capacitor
console.log('[3/4] Injetando Capacitor bridge no HTML...');
const indexPath = path.join(DEST_DIR, 'index.html');
if (fs.existsSync(indexPath)) {
  injectCapacitorScript(indexPath);
  console.log('      ✓ capacitor.js adicionado');
  console.log('      ✓ viewport-fit=cover configurado');
  console.log('      ✓ safe-area padding adicionado');
} else {
  console.error('      ✗ ERRO: index.html não encontrado!');
  process.exit(1);
}

// 4. Criar arquivo de manifesto
console.log('[4/4] Gerando manifesto...');
const manifest = {
  name: 'Ephemeral Chat',
  short_name: 'Ephemeral',
  version: '1.0.0',
  build_date: new Date().toISOString(),
  platform: 'android'
};
fs.writeFileSync(
  path.join(DEST_DIR, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
  'utf-8'
);

console.log('');
console.log('✓ Build concluído com sucesso!');
console.log(`  Arquivos em: ${DEST_DIR}`);
console.log('');
console.log('Próximo passo: npx cap sync android');
