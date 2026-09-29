/**
 * Runs as a plain inline <script> in <head>, while the HTML is still being
 * parsed, so the first paint already has this browser's choices:
 *
 * - the theme and colour palette, and
 * - each saved profile picture, as a background on `[data-avatar-id]` avatars
 *   (initials hidden), until React renders the picture itself.
 *
 * It must not wait for Next's runtime: `next/script`'s beforeInteractive
 * queues inline code to run after the page's JavaScript loads, which showed
 * the default theme and initials for about a second on every refresh.
 *
 * Only a base64 image data URL and a plain id are written into CSS, so a
 * stored value can never break out of the rule.
 */
export const bootScript = String.raw`(function(){try{
var d=document.documentElement,s=window.localStorage,t=s.getItem('enercore-theme');
d.dataset.theme=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
var p=s.getItem('enercore-palette');
if(['company','ocean','forest','violet','rose','slate'].indexOf(p)>-1)d.dataset.palette=p;
var css='';
for(var i=0;i<s.length;i++){
var k=s.key(i);if(!k||k.indexOf('enercore-avatar-')!==0)continue;
var id=k.slice(16),v=s.getItem(k)||'';
if(/^[A-Za-z0-9_-]+$/.test(id)&&/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(v))
css+='[data-avatar-id="'+id+'"]{background:center/cover no-repeat url('+v+')!important;color:transparent!important}';
}
if(css){var st=document.createElement('style');st.id='enercore-avatar-css';st.textContent=css;document.head.appendChild(st)}
}catch(e){}})();`;
