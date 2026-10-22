module.exports = {
  asar: true,
  npmRebuild: false,
  directories: { output: 'dist' },
  files: ['out/**/*', 'package.json'],
  extraResources: [
    {
      from: '../../assets/branding/icon.png',
      to: 'branding/icon.png',
    },
  ],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: expanded by electron-builder.
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  win: { target: ['portable'], icon: '../../assets/branding/icon.ico' },
  mac: { target: ['zip'] },
  linux: { target: ['tar.gz'], category: 'Game', icon: '../../assets/branding/icon.png' },
};
