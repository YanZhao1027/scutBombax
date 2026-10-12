/**
 * PUBLIC SHOWCASE ONLY.
 * This Worker never receives student information, uploaded materials, credentials,
 * real-location coordinates, or school authentication tokens.
 * All UI state stays in the user's own browser. /api/ is disabled.
 */
const CSP=["default-src 'none'","script-src 'self'","style-src 'self'","img-src 'self' data:","connect-src 'self'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'"].join('; ');
export default {
 async fetch(request, env) {
   const url=new URL(request.url);
   if(url.pathname.startsWith('/api/') || request.method!=='GET' && request.method!=='HEAD'){
     return new Response(JSON.stringify({error:'此地址仅供公开演示，不接收真实报名或个人资料'}),{
       status:403,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
   }
   const response=await env.ASSETS.fetch(request);
   const headers=new Headers(response.headers);
   headers.set('Content-Security-Policy',CSP);
   headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
   headers.set('Referrer-Policy','no-referrer');
   headers.set('X-Content-Type-Options','nosniff');
   headers.set('X-Frame-Options','DENY');
   headers.set('Cross-Origin-Resource-Policy','same-origin');
   headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
   headers.set('Cache-Control','no-cache');
   return new Response(response.body,{status:response.status,headers});
 }
};
