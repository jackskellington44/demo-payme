(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`https://4thworld.army`,t=1e3,n=1;function r(e,t=220){if(!e)return``;let n=String(e).replace(/\s+/g,` `).trim();return n.length>t?n.slice(0,t)+`...`:n}function i({path:t,status:n,statusText:i,contentType:a,bodyPreview:o,parseFailure:s=!1,context:c=`request`}){let l=r(o),u=/<!doctype html|<html[\s>]/i.test(l),d=[`${c} failed`,`url=${e}${t}`,`path=${t}`,`status=${n}${i?` ${i}`:``}`,`content-type=${a||`unknown`}`];return s&&d.push(`reason=Expected JSON response but received non-JSON body`),u&&d.push(`hint=Response appears to be HTML (likely wrong route, reverse-proxy rewrite, or SPA fallback)`),o&&d.push(`body-preview="${l}"`),d.join(` | `)}function a(t,n){return`endpoint=${e}${t} | ${String(n||`Unknown API error`)}`}function o(t,n,r=`API request`){let i=String(n?.message||n||`Network error`),a=typeof navigator<`u`&&typeof navigator.onLine==`boolean`?navigator.onLine:`unknown`,o=typeof window<`u`&&window.location?window.location.origin:`unknown`,s=[];i.toLowerCase().includes(`failed to fetch`)&&(s.push(`Browser could not establish an HTTP response`),s.push(`Check HTTPS certificate, DNS, ad-blocker/privacy extensions, and CDN/firewall rules`)),n?.name===`AbortError`&&s.push(`Request timed out or was aborted before the server responded`);let c=[`${r} network failure`,`url=${e}${t}`,`origin=${o}`,`online=${a}`,`error=${i}`];return s.length&&c.push(`hint=${s.join(`; `)}`),c.join(` | `)}function s(e){return new Promise(t=>setTimeout(t,e))}async function c(e,r={},i=3e4){for(let a=0;a<=n;a+=1){let o=new AbortController,c=setTimeout(()=>o.abort(),i),l={...r,signal:o.signal};try{return await fetch(e,l)}catch(e){if(e?.name===`AbortError`||a===n)throw e;await s(t)}finally{clearTimeout(c)}}throw Error(`Request failed`)}function l(){return localStorage.getItem(`auth_token`)}function u(e,t){localStorage.setItem(`auth_token`,e),localStorage.setItem(`auth_user`,JSON.stringify(t))}function d(){let e=l();return e?{Authorization:`Bearer `+e}:{}}async function f(t,n={},r=3e4){try{let a=await c(`${e}${t}`,n,r),o=a.headers.get(`content-type`)||``,s=await a.text(),l=null;if(s)try{l=JSON.parse(s)}catch{l=null}return l?a.ok?l:{data:null,error:l.error||i({path:t,status:a.status,statusText:a.statusText,contentType:o,bodyPreview:s,context:`API request`})}:{data:null,error:i({path:t,status:a.status,statusText:a.statusText,contentType:o,bodyPreview:s,parseFailure:!0,context:`API request`})}}catch(e){return{data:null,error:o(t,e,`API request`)}}}async function p(t,{method:n=`GET`,token:r,body:a}={},s=3e4){let l={"Content-Type":`application/json`};r&&(l.Authorization=`Bearer `+r);try{let r=await c(`${e}${t}`,{method:n,headers:l,body:a===void 0?void 0:JSON.stringify(a)},s),o=r.headers.get(`content-type`)||``,u=await r.text(),d={};if(u)try{d=JSON.parse(u)}catch{d={}}return r.ok?!d||typeof d==`object`&&Object.keys(d).length===0&&u?{data:null,error:i({path:t,status:r.status,statusText:r.statusText,contentType:o,bodyPreview:u,parseFailure:!0,context:`API request`})}:d:{data:null,error:d.error||i({path:t,status:r.status,statusText:r.statusText,contentType:o,bodyPreview:u,context:`API request`})}}catch(e){return{data:null,error:o(t,e,`API request`)}}}async function m(t,{token:n,fields:r={},file:a}={}){let s=new FormData;for(let[e,t]of Object.entries(r))s.append(e,t);a&&s.append(`file`,a);let c={};n&&(c.Authorization=`Bearer `+n);try{let n=await fetch(`${e}${t}`,{method:`POST`,headers:c,body:s}),r=n.headers.get(`content-type`)||``,a=await n.text(),o={};if(a)try{o=JSON.parse(a)}catch{o={}}return n.ok?!o||typeof o==`object`&&Object.keys(o).length===0&&a?{data:null,error:i({path:t,status:n.status,statusText:n.statusText,contentType:r,bodyPreview:a,parseFailure:!0,context:`Upload request`})}:o:{data:null,error:o.error||i({path:t,status:n.status,statusText:n.statusText,contentType:r,bodyPreview:a,context:`Upload request`})}}catch(e){return{data:null,error:o(t,e,`Upload request`)}}}function h(t,n){return`${e}/api/storage/public/${encodeURIComponent(t)}/${n}`}var g={auth:{signUp:async({username:e,password:t,pfp:n})=>{let r=await f(`/auth/signup`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({username:e,password:t,pfp:n})});return r.error?{data:null,error:a(`/auth/signup`,r.error)}:(r.data?.token&&u(r.data.token,r.data.user),r)},signIn:async({username:e,password:t})=>{let n=await f(`/auth/login`,{method:`POST`,headers:{"Content-Type":`application/json`},body:JSON.stringify({username:e,password:t})});return n.error?{data:null,error:a(`/auth/login`,n.error)}:(n.data?.token&&u(n.data.token,n.data.user),n)},signOut:async()=>{localStorage.removeItem(`auth_token`),localStorage.removeItem(`auth_user`)},getUser:async()=>l()?f(`/auth/me`,{headers:{...d()}}):{data:null,error:`Not authenticated`},uploadPfp:async e=>{let t=new FormData;return t.append(`file`,e),f(`/auth/upload-pfp`,{method:`POST`,headers:{...d()},body:t})}},worlds:{getTheme:async e=>f(`/worlds/${encodeURIComponent(e)}/theme`)},users:{getByUsername:async e=>f(`/api/users?username=${encodeURIComponent(e)}`),getById:async e=>f(`/api/users/${encodeURIComponent(e)}`)}},_=`auth_token`,v=`auth_user`,y=1e4,b=new Map,x=new Map;function S(e=Date.now()){for(let[t,n]of x.entries())(!n||e-n.timestamp>y)&&x.delete(t)}function C(){try{return window.localStorage.getItem(_)||null}catch{return null}}function w(){try{let e=window.localStorage.getItem(v);return e?JSON.parse(e):null}catch{return null}}function T(e){try{e?window.localStorage.setItem(_,e):(window.localStorage.removeItem(_),window.localStorage.removeItem(v))}catch{}}var E=class{constructor(e){this.table=e,this.mode=`select`,this.selectColumns=`*`,this.filters=[],this.orExpr=null,this.orderBy=[],this.limitValue=null,this.rangeValue=null,this.singleMode=!1,this.maybeSingleMode=!1,this.mutationValues=null,this.returningSelect=null}select(e=`*`){return this.mode===`select`?(this.selectColumns=e||`*`,this):(this.returningSelect=e||`*`,this)}insert(e){return this.mode=`insert`,this.mutationValues=e,this}update(e){return this.mode=`update`,this.mutationValues=e,this}delete(){return this.mode=`delete`,this.mutationValues=null,this}eq(e,t){return this.filters.push({column:e,operator:`eq`,value:t}),this}in(e,t){return this.filters.push({column:e,operator:`in`,value:Array.isArray(t)?t:[]}),this}is(e,t){return this.filters.push({column:e,operator:`is`,value:t}),this}or(e){return this.orExpr=e,this}order(e,t={}){return this.orderBy.push({column:e,ascending:t?.ascending!==!1}),this}limit(e){return this.limitValue=Number.isFinite(e)?Math.max(0,Math.floor(e)):null,this}range(e,t){return this.rangeValue={from:Number.isFinite(e)?Math.floor(e):0,to:Number.isFinite(t)?Math.floor(t):0},this}single(){return this.singleMode=!0,this.maybeSingleMode=!1,this}maybeSingle(){return this.singleMode=!1,this.maybeSingleMode=!0,this}async execute(){let e=C();if(this.mode===`select`){let t={table:this.table,select:this.selectColumns,filters:this.filters,or:this.orExpr,order:this.orderBy,limit:this.limitValue,range:this.rangeValue,single:this.singleMode,maybeSingle:this.maybeSingleMode};console.log(`[db-query]`,t.table,t.filters,Date.now());let n=JSON.stringify(t),r=Date.now();if(S(r),b.has(n))return console.warn(`[db-query skipped duplicate]`,n),b.get(n);let i=x.get(n);if(i&&r-i.timestamp<=y)return console.warn(`[db-query skipped duplicate]`,n),i.result;let a=p(`/api/db/query`,{method:`POST`,token:e,body:t}).then(e=>(e?.error||x.set(n,{timestamp:Date.now(),result:e}),e)).finally(()=>{b.delete(n)});return b.set(n,a),a}return p(`/api/db/mutate`,{method:`POST`,token:e,body:{table:this.table,action:this.mode,values:this.mutationValues,filters:this.filters,or:this.orExpr,select:this.returningSelect,single:this.singleMode,maybeSingle:this.maybeSingleMode}})}then(e,t){return this.execute().then(e,t)}catch(e){return this.execute().catch(e)}},D=class{constructor(e){this.bucket=e}upload(e,t,n={}){return m(`/api/storage/upload`,{token:C(),fields:{bucket:this.bucket,path:e,upsert:n?.upsert?`true`:`false`},file:t})}list(e=``){return p(`/api/storage/list`,{method:`POST`,token:C(),body:{bucket:this.bucket,prefix:e}})}remove(e){return p(`/api/storage/remove`,{method:`POST`,token:C(),body:{bucket:this.bucket,paths:Array.isArray(e)?e:[]}})}getPublicUrl(e){return{data:{publicUrl:h(this.bucket,e)}}}},O=class{from(e){return new D(e)}},k=class{constructor(){this.handlers=[]}on(e,t,n){return typeof n==`function`&&this.handlers.push(n),this}subscribe(e){return typeof e==`function`&&window.setTimeout(()=>e(`SUBSCRIBED`),0),this}},A={from(e){return new E(e)},auth:new class{async signUp({email:e,password:t}){return p(`/api/auth/signup`,{method:`POST`,body:{email:e,password:t}})}async signInWithPassword({email:e,password:t}){let n=await p(`/api/auth/signin`,{method:`POST`,body:{email:e,password:t}});return T(n?.data?.session?.access_token||null),n}async signOut(){return T(null),{data:null,error:null}}async getSession(){let e=C(),t=w();return!e||!t?{data:{session:null},error:null}:{data:{session:{access_token:e,user:t}},error:null}}async getUser(){return{data:{user:w()||null},error:null}}},storage:new O,rpc(e,t={}){return p(`/api/rpc/${encodeURIComponent(e)}`,{method:`POST`,token:C(),body:t})},channel(e){return new k}},j=!1;function M(e){let t=String(e||``),n=2166136261;for(let e=0;e<t.length;e++)n^=t.charCodeAt(e),n=Math.imul(n,16777619);return n>>>0}function N(e={}){if(j||typeof window>`u`||typeof document>`u`)return;let t=e.baseUrl||`/`,n=[],r=!1,i=0,a=Array.isArray(e.gifPool)&&e.gifPool.length>0?e.gifPool:[`${t}images/pfps/pfp1.webp`,`${t}images/pfps/pfp3.webp`,`${t}images/pfps/pfp6.webp`,`${t}images/pfps/pfp8.webp`,`${t}images/pfps/pfp11.webp`,`${t}images/pfps/pfp14.webp`,`${t}images/pfps/pfp17.webp`],o=[`I hate to do this to you.`,`Welp, this is embrassing!`,`This was probably your fault.`,`Ask Rafi idk`,`Would not you like to know, weather boy?`,`You did not cook.`,`Oh, well.`],s=document.createElement(`style`);s.textContent=`
    .pretty-alert-host {
      position: fixed;
      top: 18px;
      left: 18px;
      z-index: 1200;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
      max-width: min(540px, calc(100vw - 36px));
      font-family: var(--font-family, Arial, sans-serif);
    }

    .pretty-alert-card {
      position: relative;
      pointer-events: auto;
      display: grid;
      grid-template-columns: 98px 1fr auto;
      gap: 14px;
      align-items: center;
      background: rgba(0, 0, 0, 0.68);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 2px;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
      padding: 13px;
      animation: pretty-alert-in 180ms ease;
      backdrop-filter: blur(5px);
    }

    .pretty-alert-card::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0));
      pointer-events: none;
    }

    .pretty-alert-card::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 1px;
      background: rgba(255, 255, 255, 0.2);
      pointer-events: none;
    }

    .pretty-alert-gif {
      width: 98px;
      height: 98px;
      object-fit: cover;
      border-radius: 0;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.06);
      box-shadow: none;
    }

    .pretty-alert-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .pretty-alert-title {
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: 0.035em;
      text-transform: lowercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pretty-alert-message {
      font-size: 0.92rem;
      line-height: 1.38;
      color: rgba(255, 255, 255, 0.74);
      word-break: break-word;
      max-height: 7.2em;
      overflow: auto;
      padding-right: 4px;
    }

    .pretty-alert-meta {
      font-size: 0.68rem;
      color: rgba(255, 255, 255, 0.38);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .pretty-alert-close {
      align-self: flex-start;
      border: 0;
      background: transparent;
      color: rgba(255, 255, 255, 0.55);
      border-radius: 0;
      font-size: 1.06rem;
      line-height: 1;
      cursor: pointer;
      padding: 2px 3px;
      border: none;
      opacity: 0.8;
    }

    .pretty-alert-close:hover {
      color: rgba(255, 255, 255, 0.95);
      opacity: 1;
    }

    @keyframes pretty-alert-in {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 720px) {
      .pretty-alert-host {
        left: 10px;
        right: 10px;
        max-width: none;
      }

      .pretty-alert-card {
        grid-template-columns: 74px 1fr auto;
        gap: 10px;
        padding: 10px;
        border-radius: 1px;
      }

      .pretty-alert-gif {
        width: 74px;
        height: 74px;
      }

      .pretty-alert-title {
        font-size: 0.92rem;
      }

      .pretty-alert-message {
        font-size: 0.82rem;
      }
    }

    .pretty-confirm-overlay {
      position: fixed;
      inset: 0;
      z-index: 1300;
      background: rgba(0, 0, 0, 0.52);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      backdrop-filter: blur(4px);
    }

    .pretty-confirm-modal {
      width: min(560px, 100%);
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.74);
      color: rgba(255, 255, 255, 0.9);
      border-radius: 2px;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
    }

    .pretty-confirm-modal::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 1px;
      background: rgba(255, 255, 255, 0.2);
      pointer-events: none;
    }

    .pretty-confirm-title {
      font-size: 0.98rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: lowercase;
      color: rgba(255, 255, 255, 0.9);
    }

    .pretty-confirm-message {
      font-size: 0.88rem;
      line-height: 1.38;
      color: rgba(255, 255, 255, 0.72);
      white-space: pre-wrap;
    }

    .pretty-confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
      flex-wrap: wrap;
    }

    .pretty-confirm-btn {
      border: 1px solid rgba(255, 255, 255, 0.24);
      background: transparent;
      color: rgba(255, 255, 255, 0.72);
      font-family: inherit;
      font-size: 0.82rem;
      letter-spacing: 0.06em;
      text-transform: lowercase;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 1px;
      min-width: 96px;
    }

    .pretty-confirm-btn:hover {
      color: rgba(255, 255, 255, 0.95);
      border-color: rgba(255, 255, 255, 0.45);
    }

    .pretty-confirm-btn.danger {
      color: rgba(255, 145, 145, 0.92);
      border-color: rgba(255, 145, 145, 0.5);
    }

    .pretty-confirm-btn.danger:hover {
      color: rgba(255, 185, 185, 0.98);
      border-color: rgba(255, 185, 185, 0.78);
    }

    @media (max-width: 720px) {
      .pretty-confirm-overlay {
        padding: 10px;
      }

      .pretty-confirm-modal {
        padding: 14px;
      }

      .pretty-confirm-btn {
        min-width: 86px;
        padding: 7px 10px;
      }
    }
  `,document.head.appendChild(s);let c=document.createElement(`div`);c.className=`pretty-alert-host`,document.body.appendChild(c);let l=()=>{if(r)return;let e=n.shift();if(!e)return;r=!0;let t=String(e.message||`Something went wrong.`),s=M(t+String(Date.now())),u=o[s%o.length],d=a[s%a.length],f=`${new Date().toLocaleTimeString([],{hour:`2-digit`,minute:`2-digit`})} #${(++i).toString(36)}`,p=document.createElement(`div`);p.className=`pretty-alert-card`;let m=document.createElement(`img`);m.className=`pretty-alert-gif`,m.src=d,m.alt=`alert animation`;let h=document.createElement(`div`);h.className=`pretty-alert-copy`;let g=document.createElement(`div`);g.className=`pretty-alert-title`,g.textContent=u;let _=document.createElement(`div`);_.className=`pretty-alert-message`,_.textContent=t;let v=document.createElement(`div`);v.className=`pretty-alert-meta`,v.textContent=f;let y=document.createElement(`button`);y.className=`pretty-alert-close`,y.type=`button`,y.setAttribute(`aria-label`,`dismiss`),y.textContent=`x`,h.appendChild(g),h.appendChild(_),h.appendChild(v),p.appendChild(m),p.appendChild(h),p.appendChild(y),c.appendChild(p);let b=!1,x=()=>{b||(b=!0,p.remove(),r=!1,l())};y.addEventListener(`click`,x),window.setTimeout(x,e.durationMs||6400)},u=(e,t=6400)=>{n.push({message:e,durationMs:t}),l()},d=({title:e=`are you sure?`,message:t=`This action cannot be undone.`,confirmLabel:n=`continue`,cancelLabel:r=`cancel`,danger:i=!1}={})=>new Promise(a=>{let o=document.createElement(`div`);o.className=`pretty-confirm-overlay`;let s=document.createElement(`div`);s.className=`pretty-confirm-modal`,s.setAttribute(`role`,`dialog`),s.setAttribute(`aria-modal`,`true`);let c=document.createElement(`div`);c.className=`pretty-confirm-title`,c.textContent=e;let l=document.createElement(`div`);l.className=`pretty-confirm-message`,l.textContent=t;let u=document.createElement(`div`);u.className=`pretty-confirm-actions`;let d=document.createElement(`button`);d.className=`pretty-confirm-btn`,d.type=`button`,d.textContent=r;let f=document.createElement(`button`);f.className=`pretty-confirm-btn${i?` danger`:``}`,f.type=`button`,f.textContent=n,u.appendChild(d),u.appendChild(f),s.appendChild(c),s.appendChild(l),s.appendChild(u),o.appendChild(s),document.body.appendChild(o);let p=e=>{window.removeEventListener(`keydown`,m,!0),o.remove(),a(e)},m=e=>{e.key===`Escape`&&(e.preventDefault(),p(!1)),e.key===`Enter`&&(e.preventDefault(),p(!0))};o.addEventListener(`click`,e=>{e.target===o&&p(!1)}),d.addEventListener(`click`,()=>p(!1)),f.addEventListener(`click`,()=>p(!0)),window.addEventListener(`keydown`,m,!0),d.focus()}),f=({title:e=`choose an option`,message:t=``,choices:n=[],cancelLabel:r=`cancel`}={})=>new Promise(i=>{let a=Array.isArray(n)?n.filter(e=>e&&e.value!=null):[];if(a.length===0){i(null);return}let o=document.createElement(`div`);o.className=`pretty-confirm-overlay`;let s=document.createElement(`div`);s.className=`pretty-confirm-modal`,s.setAttribute(`role`,`dialog`),s.setAttribute(`aria-modal`,`true`);let c=document.createElement(`div`);c.className=`pretty-confirm-title`,c.textContent=e;let l=document.createElement(`div`);l.className=`pretty-confirm-message`,l.textContent=t;let u=document.createElement(`div`);u.className=`pretty-confirm-actions`;let d=[];a.forEach(e=>{let t=document.createElement(`button`);t.className=`pretty-confirm-btn${e.danger?` danger`:``}`,t.type=`button`,t.textContent=e.label||String(e.value),t.dataset.choiceValue=String(e.value),u.appendChild(t),d.push(t)});let f=document.createElement(`button`);f.className=`pretty-confirm-btn`,f.type=`button`,f.textContent=r,u.appendChild(f),s.appendChild(c),s.appendChild(l),s.appendChild(u),o.appendChild(s),document.body.appendChild(o);let p=e=>{window.removeEventListener(`keydown`,m,!0),o.remove(),i(e)},m=e=>{if(e.key===`Escape`){e.preventDefault(),p(null);return}e.key===`Enter`&&(e.preventDefault(),p(a[0]?.value??null))};o.addEventListener(`click`,e=>{e.target===o&&p(null)}),f.addEventListener(`click`,()=>p(null)),d.forEach((e,t)=>{e.addEventListener(`click`,()=>{p(a[t]?.value??null)})}),window.addEventListener(`keydown`,m,!0),d[0]?.focus()});window.__prettyAlert=u,window.__prettyConfirm=d,window.__prettyChoice=f,window.alert=e=>u(e),j=!0}export{A as n,g as r,N as t};