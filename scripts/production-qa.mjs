import { chromium } from '@playwright/test';
const base = process.env.PRODUCTION_URL || 'https://cloud-bot-production-efa0.up.railway.app';
const viewports = [[320,568],[360,640],[375,667],[390,844],[393,852],[412,915],[430,932],[768,1024],[1024,768],[1280,720],[1366,768],[1440,900],[1920,1080]];
const routes = ['/', '/search', '/profile', '/settings', '/history', '/chats'];
const browser = await chromium.launch({headless:true}); const page=await browser.newPage();
const rows=[]; let failed=0;
for (const [width,height] of viewports) {
  await page.setViewportSize({width,height});
  for (const route of routes) {
    const errors=[], requests=[]; const onConsole=m=>{if(m.type()==='error')errors.push(m.text())}; const onRequestFailed=r=>requests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText||''}`);
    page.on('console',onConsole); page.on('requestfailed',onRequestFailed);
    const response=await page.goto(base+route,{waitUntil:'networkidle',timeout:30000});
    const metrics=await page.evaluate(() => { const doc = globalThis.document; return {scrollWidth:doc.documentElement.scrollWidth,innerWidth:globalThis.innerWidth,content:doc.querySelector('#main-content')?.textContent?.trim().length||0,nav:!!doc.querySelector('nav[aria-label="Основная навигация"]'),navRect:doc.querySelector('nav[aria-label="Основная навигация"]')?.getBoundingClientRect().toJSON(),docHeight:doc.documentElement.scrollHeight}; });
    const bad= response?.status()!==200 || errors.length || requests.length || metrics.scrollWidth>metrics.innerWidth+1 || !metrics.content || !metrics.nav || (metrics.navRect && metrics.navRect.bottom>height+1);
    if(bad) failed++;
    rows.push({width,height,route,status:response?.status(),errors:errors.length,failedRequests:requests.length,...metrics,bad});
    page.off('console',onConsole); page.off('requestfailed',onRequestFailed);
  }
}
await browser.close(); console.log(JSON.stringify({base,failed,total:rows.length,rows},null,2)); process.exitCode=failed?1:0;
