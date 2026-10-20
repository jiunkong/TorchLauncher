module.exports = {
  asar: true,
  npmRebuild: false,
  directories: { output: 'dist' },
  files: ['out/**/*', 'package.json'],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: expanded by electron-builder.
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  win: { target: ['portable'] },
  mac: { target: ['zip'] },
  linux: { target: ['tar.gz'], category: 'Game' },
};
