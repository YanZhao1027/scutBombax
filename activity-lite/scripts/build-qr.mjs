// Bundle qrcode from the adjacent existing development workspace, without CDN.
import {build} from '../../../scutBombax-2.0.0-beta/node_modules/.pnpm/node_modules/esbuild/lib/main.js';
await build({
  entryPoints:[new URL('./qr-entry.js',import.meta.url).pathname],
  outfile:new URL('../public/qr-vendor.js',import.meta.url).pathname,
  bundle:true,platform:'browser',format:'iife',globalName:'LiteQr',
  minify:true,legalComments:'inline',
  nodePaths:[new URL('../../activity-quickcheck/node_modules',import.meta.url).pathname]
});
console.log('Bundled client-side QR encoder (no backend PNG generation).');
