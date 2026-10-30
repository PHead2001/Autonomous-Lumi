export interface HomeLabCheck {name:string;status:'PASS'|'FAIL'|'INCONCLUSIVE';expected:string;observed:string}
export interface HomeLabProgress {scenarioId:string;status:'RUNNING'|'PASS'|'FAIL'|'INCONCLUSIVE';phase:string;expected:string;observed:string;viewerUrl:string;exportUrl?:string;checks?:HomeLabCheck[]}
const bounded=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
export function localHomeLabUrl(value:string,origin:string,kind:'viewer'|'export'):string {
  const url=new URL(value,origin);if(url.origin!==origin||url.username||url.password||kind==='viewer'&&url.pathname!=='/'||kind==='export'&&!url.pathname.startsWith('/api/'))throw new Error('The experiment link must stay in this local application.');
  if(kind==='viewer'&&(!url.searchParams.get('worldId')||!url.searchParams.get('branchId')||url.searchParams.get('branchId')==='live'||url.searchParams.get('view')==='dashboard'))throw new Error('The demo must open an isolated experiment viewer.');
  return url.href;
}
export function readHomeLabProgress(value:unknown,expectedScenario?:string):HomeLabProgress {
  const v=value as HomeLabProgress;
  if(!v||!bounded(v.scenarioId,100)||!/^[A-Za-z0-9_-]+$/.test(v.scenarioId)||expectedScenario!==undefined&&v.scenarioId!==expectedScenario||!['RUNNING','PASS','FAIL','INCONCLUSIVE'].includes(v.status)||!bounded(v.phase,240)||!bounded(v.expected,1000)||!bounded(v.observed,1000)||!bounded(v.viewerUrl,1500)||v.exportUrl!==undefined&&!bounded(v.exportUrl,1500)||v.checks!==undefined&&(!Array.isArray(v.checks)||v.checks.length>24||v.checks.some(c=>!bounded(c.name,160)||!['PASS','FAIL','INCONCLUSIVE'].includes(c.status)||!bounded(c.expected,1000)||!bounded(c.observed,1000))))throw new Error('The experiment returned invalid or mismatched progress.');
  return v;
}
/** One small entry shared by the normal viewer and Advanced; it never sends a final action or edits LIVE. */
export function mountHomeLabCard(container:HTMLElement) {
  container.innerHTML=`<div><p class="eyebrow">GUIDED LAB · ISOLATED EXPERIMENT</p><h2>Try a home activity</h2><p>Current needs and actual observations drive the same home controller. LIVE is not reset or accelerated; no paid calls are made.</p></div><div class="home-demo-choice"><label>Demonstration <select data-role="scenario"><option value="food">Find food and eat</option><option value="bed">Find bed and sleep</option></select></label><button data-role="start">Start isolated demonstration</button></div><p data-role="status" role="status">Choose an isolated demonstration. Outcomes are reported from actual evidence.</p><div data-role="links"><a data-role="viewer" hidden target="_blank" rel="noopener">Open EXPERIMENT viewer</a><a data-role="export" hidden>Download diagnostic ZIP</a></div><details data-role="evidence" hidden><summary>Expected and observed evidence</summary><p data-role="expected"></p><p data-role="observed"></p><ul data-role="checks"></ul></details>`;
  const find=<T extends HTMLElement>(role:string)=>container.querySelector<T>(`[data-role="${role}"]`)!;
  const button=find<HTMLButtonElement>('start'),scenario=find<HTMLSelectElement>('scenario'),status=find('status'),viewer=find<HTMLAnchorElement>('viewer'),download=find<HTMLAnchorElement>('export');
  let generation=0,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,current:HomeLabProgress|undefined,suspended=false;
  function render(progress:HomeLabProgress){
    current=progress;const running=progress.status==='RUNNING';button.disabled=running;scenario.disabled=running;button.textContent=running?'Experiment running…':'Start a new isolated demonstration';
    status.textContent=`${progress.status} · ${progress.phase}${progress.observed?` · ${progress.observed}`:''}`;
    viewer.href=localHomeLabUrl(progress.viewerUrl,location.origin,'viewer');viewer.hidden=false;
    download.hidden=!progress.exportUrl;if(progress.exportUrl){download.href=localHomeLabUrl(progress.exportUrl,location.origin,'export');download.download='lumi-home-experiment.zip';}
    find('evidence').hidden=false;find('expected').textContent=`Expected: ${progress.expected}`;find('observed').textContent=`Observed: ${progress.observed}`;
    const rows=(progress.checks??[]).map(check=>{const row=document.createElement('li');row.textContent=`${check.status} · ${check.name} — expected ${check.expected}; observed ${check.observed}`;return row;});find('checks').replaceChildren(...rows);
  }
  async function request(url:string,init?:RequestInit){const response=await fetch(url,{...init,signal:controller?.signal});const body=await response.json();if(!response.ok)throw new Error(typeof body.error==='string'?body.error:'Experiment request failed.');return body;}
  function failure(error:unknown){if(error instanceof DOMException&&error.name==='AbortError')return;button.disabled=false;scenario.disabled=false;button.textContent='Start a new isolated demonstration';status.textContent=`Could not confirm experiment progress: ${error instanceof Error?error.message:'Request failed'}. An already started experiment may still be running.`;}
  async function refresh(expected:string,token:number){
    if(suspended||token!==generation)return;controller=new AbortController();
    try{const next=readHomeLabProgress(await request(`/api/home-lab?${new URLSearchParams({scenarioId:expected})}`),expected);if(suspended||token!==generation)return;render(next);if(next.status==='RUNNING')timer=setTimeout(()=>{void refresh(expected,token);},1000);}catch(error){if(token===generation)failure(error);}
  }
  button.onclick=async()=>{
    const token=++generation;current=undefined;clearTimeout(timer);controller?.abort();controller=new AbortController();button.disabled=true;scenario.disabled=true;viewer.hidden=download.hidden=true;find('evidence').hidden=true;status.textContent='Creating a separate experiment…';
    try{const next=readHomeLabProgress(await request('/api/home-lab/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:scenario.value})}));if(suspended||token!==generation)return;render(next);if(next.status==='RUNNING')timer=setTimeout(()=>{void refresh(next.scenarioId,token);},1000);}catch(error){if(token===generation)failure(error);}
  };
  const hide=()=>{suspended=true;clearTimeout(timer);controller?.abort();};const show=(event:PageTransitionEvent)=>{if(event.persisted){suspended=false;if(current?.status==='RUNNING')void refresh(current.scenarioId,generation);else if(!current){button.disabled=false;scenario.disabled=false;status.textContent='The start request was interrupted. An experiment may already exist; check Advanced before creating another.';}}};
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  return ()=>{generation++;hide();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);};
}
