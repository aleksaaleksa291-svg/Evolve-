const CACHE="evolve-supabase-v3";
const ASSETS=["./","./index.html","./auth.html","./supabase-config.js","./supabase-auth.js","./supabase-sync.js","./manifest.json","./icon.svg"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("evolve-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET"||new URL(event.request.url).origin!==self.location.origin)return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).then(async response=>{
      if(!response.ok)return response;
      const url=new URL(event.request.url);
      const isAppPage=url.pathname.endsWith("/")||url.pathname.endsWith("/index.html");
      const type=response.headers.get("content-type")||"";
      if(!isAppPage||!type.includes("text/html")){
        const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
      }
      let html=await response.text();
      if(!html.includes("supabase-sync.js"))html=html.replace(/<\/body>/i,'<script src="./supabase-config.js"></script><script type="module" src="./supabase-sync.js"></script></body>');
      const headers=new Headers(response.headers);headers.delete("content-length");headers.delete("content-encoding");
      const upgraded=new Response(html,{status:response.status,statusText:response.statusText,headers});
      caches.open(CACHE).then(cache=>cache.put(event.request,upgraded.clone()));
      return upgraded;
    }).catch(()=>caches.match(event.request).then(cached=>cached||caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>caches.match("./index.html"))));
});
