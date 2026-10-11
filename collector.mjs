import {VERSION,mergeTransactions} from './core.mjs';
import {parseWallet,parseMarket,parseDocument,pageMeta} from './parsers.mjs';

export function emptySnapshot(accountId='local') {
  return {version:VERSION,accountId,updatedAt:null,wallet:{transactions:[],warnings:[],complete:false,cursor:null,offset:0,initialized:false},market:{transactions:[],warnings:[],complete:false,start:0,expected:null,initialized:false},overrides:{}};
}
const aborted=()=>new DOMException('Загрузка остановлена','AbortError');
export function pause(ms,signal) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(aborted());return;}
    const stop=()=>{clearTimeout(timer);reject(aborted());};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
    signal?.addEventListener('abort',stop,{once:true});
  });
}
export class SteamCollector {
  constructor({signal,onProgress=()=>{},onSave=async()=>{},onRequest=()=>{},currency=null,delay=1500,fetcher=(url,options)=>globalThis.fetch(url,options),timeoutMs=30000,waiter=pause}) {
    // Native Window.fetch needs its browser receiver, not the collector.
    Object.assign(this,{signal,onProgress,onSave,onRequest,currency,delay,fetcher,timeoutMs,waiter});
  }
  async request(url,options={},json=false) {
    const label=String(url).includes('AjaxLoadMoreHistory')?'следующую страницу кошелька':String(url).includes('myhistory/render')?'историю торговой площадки':String(url).includes('steamcommunity.com')?'страницу торговой площадки':'историю покупок';
    for(let attempt=0;attempt<5;attempt++) {
      if(this.signal?.aborted)throw aborted();
      const timeout=new AbortController();
      const abort=()=>timeout.abort(this.signal?.reason);this.signal?.addEventListener('abort',abort,{once:true});
      const timer=setTimeout(()=>timeout.abort(new Error('Steam не ответил за 30 секунд.')),this.timeoutMs);
      let response,body,networkError;
      const record={time:new Date().toISOString(),url:String(url),method:options.method||'GET',attempt:attempt+1};
      this.onProgress({phase:'request',message:'Запрашиваю '+label+(attempt?' · попытка '+(attempt+1):'')+'…'});
      this.onRequest({...record,outcome:'pending'});
      try {
        const fetcher=this.fetcher;
        response=await fetcher(url,{...options,credentials:'include',redirect:'follow',signal:timeout.signal});
        // Keep the deadline active until the whole response has arrived.
        if(response.ok)body=await response.text();
        this.onRequest({...record,outcome:'response',status:response.status});
      }
      catch(e){
        if(this.signal?.aborted)throw aborted();
        networkError=timeout.signal.aborted?timeout.signal.reason:e;
        const reason=String(networkError?.message||networkError);
        this.onRequest({...record,outcome:'error',error:reason});
        if(/illegal invocation|content security policy|connect-src/i.test(reason))throw new Error('Запрос к Steam не был отправлен: '+reason+'. Обнови расширение и проверь доступ к сайтам Steam.');
        if(attempt===4)throw new Error('Не удалось выполнить запрос к Steam: '+reason+'. Проверь доступ расширения к сайтам Steam и соединение.');
      }
      finally{clearTimeout(timer);this.signal?.removeEventListener('abort',abort);}
      if(response?.status===401||response?.status===403)throw new Error('Steam не предоставил историю (HTTP '+response.status+'). Открой обе страницы Steam и проверь вход в аккаунт.');
      if(response?.ok&&!networkError){
        if(/\/login\b/.test(response.url)||(/id=["']login_form|id=["']loginForm/.test(body)))throw new Error('Войди в Steam в этом браузере и повтори загрузку.');
        if(!json)return body;
        try{return JSON.parse(body);}catch{throw new Error('Steam вернул страницу вместо истории. Проверь вход в аккаунт.');}
      }
      if(response&&!networkError&&response.status!==429&&response.status<500)throw new Error('Ошибка Steam HTTP '+response.status);
      if(attempt===4)throw new Error(response?.status===429?'Steam ограничил частоту запросов (HTTP 429). Продолжи загрузку позже.':'Steam вернул ошибку HTTP '+response?.status+'. Продолжи загрузку позже.');
      const retry=Number(response?.headers?.get('Retry-After'));
      const wait=Number.isFinite(retry)&&retry>0?Math.min(retry*1000,30000):Math.min(3000*2**attempt,30000);
      const reason=networkError?'Сетевой запрос не выполнен: '+String(networkError.message||networkError):response.status===429?'Steam ограничил запросы (HTTP 429)':'Steam вернул ошибку HTTP '+response.status;
      this.onProgress({phase:'retry',message:reason+'. Повтор через '+Math.ceil(wait/1000)+' сек.'});
      await this.waiter(wait,this.signal);
    }
  }
  async probe() {
    const html=await this.request('https://store.steampowered.com/account/history/?l=english');
    const parsed=parseWallet(html,{currency:this.currency});
    if(!parsed.hasTable)throw new Error('Не найдена таблица истории покупок. Проверь вход в Steam; если вход выполнен, сохрани эту страницу как HTML для проверки формата.');
    if(!parsed.meta.accountId)throw new Error('Не удалось определить Steam-аккаунт. История не будет смешана с сохранёнными данными.');
    return {html,parsed};
  }
  async collectWallet(snapshot,initial) {
    const {html,parsed}=initial;
    if(snapshot.accountId!==parsed.meta.accountId)throw new Error('История принадлежит другому Steam-аккаунту.');
    this.currency=parsed.meta.currency||this.currency;
    const part=snapshot.wallet;
    if(!part.initialized) {
      part.transactions=parsed.transactions;part.warnings=parsed.warnings;part.offset=parsed.rowCount;part.cursor=parsed.meta.cursor.value;part.initialized=true;
      part.complete=parsed.meta.cursor.found&&!part.cursor;
      // Missing cursor + a visible load button is never interpreted as full history.
      if(!parsed.meta.cursor.found){
        part.complete=!parsed.hasMoreButton;
        if(!part.complete){await this.save(snapshot);throw new Error('Steam изменил формат курсора истории. Загружена первая страница; полный итог пока недоступен.');}
      }
      await this.save(snapshot);
    }
    if(part.complete)return;
    if(!parsed.meta.sessionId)throw new Error('Не найден идентификатор сессии Steam. Открой историю покупок и повтори.');
    const seen=new Set();
    while(part.cursor) {
      const signature=JSON.stringify(part.cursor);
      if(seen.has(signature))throw new Error('Steam повторил страницу истории; загрузка остановлена, чтобы не задвоить операции.');
      seen.add(signature);
      this.onProgress({phase:'wallet',count:part.transactions.length,message:`История кошелька: ${part.transactions.length} операций`});
      await pause(this.delay,this.signal);
      const body=new URLSearchParams({sessionid:parsed.meta.sessionId});
      if(typeof part.cursor==='object')for(const [key,value] of Object.entries(part.cursor))body.set('cursor['+key+']',String(value));
      else body.set('cursor',String(part.cursor));
      const response=await this.request('https://store.steampowered.com/account/AjaxLoadMoreHistory/',{method:'POST',body,headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}},true);
      if(response.success===false||response.success===0)throw new Error('Steam отказал в загрузке следующей страницы кошелька.');
      if(!Object.hasOwn(response,'cursor')&&!Object.hasOwn(response,'html'))throw new Error('Неожиданный формат ответа истории кошелька.');
      const page=parseWallet(response.html||'',{currency:this.currency,offset:part.offset});
      if(!page.rowCount&&response.cursor)throw new Error('Steam вернул пустую страницу с продолжением. Полный итог не подтверждён.');
      part.transactions=mergeTransactions(part.transactions,page.transactions);part.warnings.push(...page.warnings);part.offset+=page.rowCount;part.cursor=response.cursor||null;part.complete=!part.cursor;
      await this.save(snapshot);
    }
  }
  async collectMarket(snapshot) {
    const html=await this.request('https://steamcommunity.com/market/?l=english');
    const meta=pageMeta(html,parseDocument(html),this.currency);
    if(!meta.accountId)throw new Error('Войди также на steamcommunity.com: без этого недоступны названия предметов с торговой площадки.');
    if(meta.accountId!==snapshot.accountId)throw new Error('В магазине Steam и на торговой площадке открыты разные аккаунты. Данные не объединены.');
    this.currency=meta.currency||this.currency;
    const part=snapshot.market;
    if(part.complete)return;
    while(!part.complete) {
      await pause(this.delay,this.signal);
      this.onProgress({phase:'market',count:part.start,total:part.expected,message:`Торговая площадка: ${part.start}${part.expected===null?'':' / '+part.expected} записей`});
      const url=new URL('https://steamcommunity.com/market/myhistory/render/');
      for(const [k,v] of Object.entries({query:'',start:part.start,count:100,l:'english'}))url.searchParams.set(k,String(v));
      const response=await this.request(url.href,{},true);
      if(response.success!==true&&response.success!==1)throw new Error('Steam не предоставил историю торговой площадки. Данные кошелька сохранены.');
      const total=Number(response.total_count),pagesize=Number(response.pagesize);
      if(!Number.isSafeInteger(total)||total<0||typeof response.results_html!=='string')throw new Error('Неожиданный формат ответа торговой площадки.');
      if(part.expected!==null&&part.expected!==total)throw new Error('Во время загрузки изменилась история торговой площадки. Нажми «Загрузить заново», чтобы страницы не сместились.');
      const page=parseMarket(response.results_html,{currency:this.currency,offset:part.start,assets:response.assets,hovers:response.hovers});
      if(page.rowCount===0&&part.start<total)throw new Error('Steam вернул пустую страницу торговой площадки до конца истории.');
      part.expected=total;part.initialized=true;
      part.transactions=mergeTransactions(part.transactions,page.transactions);part.warnings.push(...page.warnings);
      // pagesize can be capped by Steam; use the actual number of history rows,
      // not the requested count and not the number of accepted purchases.
      const step=page.rowCount||pagesize||0;
      part.start+=step;part.complete=part.start>=total;
      await this.save(snapshot);
    }
  }
  async save(snapshot) {snapshot.updatedAt=new Date().toISOString();await this.onSave(snapshot);}
}
