import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  if (request.cookies.get("fp_analytics")?.value !== "accepted") return new Response("Consent required", { status: 403, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  const id = process.env.METRICA_COUNTER_ID || "";
  if (!/^\d{1,12}$/.test(id)) return new Response("Not configured", { status: 404 });
  const nonce = randomBytes(18).toString("base64");
  const script = `const counter=${Number(id)};
let permitted=true;
// Every transport is gated before the third-party library loads, including unload beacons.
const nativeFetch=window.fetch.bind(window);
window.fetch=(...a)=>permitted?nativeFetch(...a):Promise.resolve(new Response(null,{status:204}));
const nativeBeacon=navigator.sendBeacon.bind(navigator);
navigator.sendBeacon=(...a)=>permitted?nativeBeacon(...a):false;
const nativeSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(...a){if(permitted)return nativeSend.apply(this,a);this.abort()};
for(const type of [HTMLImageElement,HTMLScriptElement]){
 const descriptor=Object.getOwnPropertyDescriptor(type.prototype,'src');
 if(descriptor?.set)Object.defineProperty(type.prototype,'src',{...descriptor,set(value){if(permitted)descriptor.set.call(this,value)}});
}
const nativeAttribute=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(name,value){if(permitted||!['src','srcset','href'].includes(name.toLowerCase()))return nativeAttribute.call(this,name,value)};
window.__disableAnalytics=()=>{permitted=false;window.stop()};
const paths=new Set(['/','/login','/register','/account','/legal','/offer','/privacy']);
window.ym=function(){(window.ym.a=window.ym.a||[]).push(arguments)};window.ym.l=Date.now();
ym(counter,'init',{defer:true,clickmap:false,trackLinks:false,accurateTrackBounce:false,webvisor:false,trackHash:false,sendTitle:false,disableYtm:true});
let last='';
addEventListener('message',e=>{
 if(!permitted||e.origin!==location.origin||e.source!==parent)return;
 const m=e.data||{};
 if(m.type==='view'){
  let u;try{u=new URL(m.url)}catch{return}
  if(u.origin!==location.origin||!paths.has(u.pathname)||m.url===last)return;
  for(const k of [...u.searchParams.keys()])if(!['utm_source','utm_medium','utm_campaign'].includes(k))u.searchParams.delete(k);
  u.hash='';last=u.href;
  let ref='';try{const r=new URL(m.referer);ref=r.origin===location.origin&&paths.has(r.pathname)?r.origin+r.pathname:r.origin}catch{}
  ym(counter,'hit',u.href,{title:String(m.title||'').slice(0,60),referer:ref});
 }else if(m.type==='goal'&&['registration_success','login_success','simulation_success'].includes(m.name)){
  ym(counter,'reachGoal',m.name,['local','yandex','vk'].includes(m.method)?{method:m.method}:{});
 }
});
const s=document.createElement('script');s.src='https://mc.yandex.ru/metrika/tag.js';s.async=true;document.head.appendChild(s);
parent.postMessage({type:'analytics-ready'},location.origin);`;
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Аналитика</title><script nonce="${nonce}">${script}</script></head><body></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://mc.yandex.ru; connect-src https://*.yandex.ru https://*.yandex.com https://*.yandex.net; img-src https://*.yandex.ru https://*.yandex.com https://*.yandex.net data:; style-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'` },
  });
}
