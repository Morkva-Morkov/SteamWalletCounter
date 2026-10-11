import {VERSION,SPEND,INCOME,tidy,formatMoney,summarize,ledger,groupGames,groupItems,inDateRange,applyOverrides,csvExport,validateSnapshot,mergeTransactions} from './core.mjs';
import {parseWallet,parseMarket} from './parsers.mjs';
import {SteamCollector,emptySnapshot} from './collector.mjs';
import {getSnapshot,getSnapshots,saveSnapshot} from './storage.mjs';
import {demoSnapshot} from './demo.mjs';
import {readSteamAccess,requireSteamAccess,requestSteamAccess} from './access.mjs';

const $=id=>document.getElementById(id);
const state={snapshot:emptySnapshot(),game:null,view:'items',page:0,busy:false,controller:null,demo:false,editId:null,progress:null,error:null,access:null,accessBusy:false,requests:[]};
const PAGE=50;
const kindNames={purchase:'Покупка',ingame:'Покупка в игре',gift:'Подарок',refund:'Возврат',topup:'Пополнение',topup_refund:'Возврат пополнения',credit:'Зачисление',other_spend:'Прочие траты',market_buy:'Покупка на площадке',market_sell:'Продажа на площадке',market_summary_buy:'Площадка: общая запись',market_summary_sell:'Площадка: общая запись',conversion:'Конвертация',unknown:'Не определено'};
function node(tag,className='',value=null){const e=document.createElement(tag);if(className)e.className=className;if(value!==null)e.textContent=value;return e;}
function bagText(bag){const pairs=Object.entries(bag);return pairs.length?pairs.map(([c,n])=>formatMoney(n,c)).join(' · '):'0,00';}
function rawTransactions(){return applyOverrides(ledger(state.snapshot),state.snapshot.overrides);}
function periodTransactions(){return rawTransactions().filter(t=>inDateRange(t,$('date-from').value,$('date-to').value));}
function filteredTransactions(){
  const search=tidy($('search').value).toLowerCase(),source=$('source-filter').value,kind=$('kind-filter').value;
  return periodTransactions().filter(t=>{
    if(state.game&&t.game!==state.game)return false;
    if(source!=='all'&&t.source!==source)return false;
    if(search&&!tidy(t.name+' '+t.game).toLowerCase().includes(search))return false;
    if(state.view==='items')return SPEND.has(t.kind);
    if(kind==='spend')return SPEND.has(t.kind);
    if(kind==='refund')return t.kind==='refund'||t.kind==='topup_refund';
    if(kind==='sales')return t.kind==='market_sell'||t.kind==='market_summary_sell';
    if(kind==='funding')return t.kind==='topup'||t.kind==='credit';
    return true;
  });
}
function setStatus(message,level=''){$('status-text').textContent=message;$('status-dot').className='status-dot '+level;}
function warningCount(){return state.snapshot.wallet.warnings.length+state.snapshot.market.warnings.length;}
function renderAccess(){
  const access=state.access;
  const message=!access?'Проверяю доступ к Steam…':!access.supported?'Демо в браузере: загрузка доступна после установки расширения.':access.granted?'Доступ к магазину и торговой площадке Steam разрешён.':'Браузер ограничил доступ к '+access.missing.map(origin=>new URL(origin).hostname).join(' и ')+'.';
  $('access-text').textContent=message;
  $('access-panel').classList.toggle('access-missing',!!access?.supported&&!access.granted);
  $('grant-access').hidden=!access?.supported||access.granted;
  $('grant-access').disabled=state.busy||state.accessBusy;
}
function renderStatus(){
  const s=state.snapshot;
  if(state.busy)setStatus(state.progress?.message||'Подготовка загрузки…','busy');
  else if(state.error)setStatus(state.error,'error');
  else if(state.demo)setStatus('Пример интерфейса — это демонстрационные данные.','ready');
  else if(s.wallet.complete&&s.market.complete)setStatus(warningCount()?'История загружена. Есть операции, которые требуют проверки.':'История загружена полностью.','ready');
  else if(s.wallet.transactions.length||s.market.transactions.length)setStatus('Сохранена часть истории. Загрузку можно продолжить.');
  else setStatus('Войди в Steam в этом браузере, затем загрузи историю.');
  const notices=[];
  if(state.demo)notices.push('Демонстрационный пример. Названия и операции условные; это не загруженная история твоего аккаунта.');
  else if(!s.wallet.complete||!s.market.complete)notices.push('Промежуточные суммы: история ещё не загружена полностью. Во время загрузки детализация площадки заменяет её общие записи из кошелька.');
  if(warningCount())notices.push(`${warningCount()} строк не удалось разобрать; они не включены в суммы. Подробности внизу страницы.`);
  const unknown=rawTransactions().filter(t=>t.kind==='unknown').length;if(unknown)notices.push(`${unknown} операций имеют неопределённый тип; они видны в режиме «Все операции», но не добавлены к расходам.`);
  const noDates=rawTransactions().filter(t=>t.timestamp===null).length;if(noDates&&($('date-from').value||$('date-to').value))notices.push(`${noDates} операций без распознанной даты исключены из выбранного периода.`);
  $('notice').textContent=notices.join(' ');$('notice').hidden=!notices.length;
  $('progress-track').hidden=!state.busy;
  const p=state.progress;
  $('progress-fill').style.width=p?.phase==='market'&&p.total>0?Math.max(3,Math.min(100,p.count/p.total*100))+'%':'20%';
  $('load-button').hidden=state.busy;$('stop-button').hidden=!state.busy;
  $('load-button').disabled=state.accessBusy;
  $('load-button').textContent=s.wallet.complete&&s.market.complete&&!state.demo?'Обновить историю':s.wallet.initialized&&!state.demo?'Продолжить загрузку':'Загрузить историю';
  for(const id of ['demo-button','restart-button','import-button','account-select','fallback-currency'])$(id).disabled=state.busy||state.accessBusy;
  $('updated-text').textContent=s.updatedAt?new Date(s.updatedAt).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'';
  $('welcome').hidden=state.busy||state.demo||s.wallet.transactions.length>0||s.market.transactions.length>0;
}
function renderGames(transactions){
  const games=groupGames(transactions),list=$('game-list');list.replaceChildren();
  $('game-count').textContent=games.length;
  if(state.game&&!games.some(g=>g.name===state.game))state.game=null;
  for(const game of games){
    const button=node('button','nav-item'+(state.game===game.name?' active':''));button.type='button';button.title=game.name;
    const mark=node('span','game-mark'+(game.name==='Dota 2'?' dota':game.name==='Counter-Strike 2'?' cs':''),game.name==='Dota 2'?'D2':game.name==='Counter-Strike 2'?'CS':game.name.slice(0,2).toUpperCase());
    button.append(mark,node('span','nav-name',game.name),node('span','nav-count',game.count));button.addEventListener('click',()=>{state.game=game.name;state.page=0;render();});list.append(button);
  }
  $('overview').classList.toggle('active',state.game===null);
  $('page-title').textContent=state.game?'Траты · '+state.game:'История твоих трат';
  $('detail-title').textContent=state.game?'Покупки · '+state.game:'Все покупки';
  return games;
}
function renderSummary(transactions,games){
  const scoped=state.game?transactions.filter(t=>t.game===state.game):transactions;
  const s=summarize(scoped);
  for(const [id,bag]of Object.entries({'spent-total':s.spent,'net-total':s.netSpent,'store-total':s.purchases,'market-total':s.marketSpent,'sales-total':s.marketReceived,'topup-total':s.topups,'refund-total':s.refunds,'other-income-total':s.otherIncome,'received-total':s.received,'other-spent-total':s.otherSpent,'topup-refund-total':s.topupRefunds}))$(id).textContent=bagText(bag);
  $('hero-label').textContent=(state.game?'Потрачено на '+state.game:'Всего потрачено')+(warningCount()?' — по распознанным операциям':'');
  const g=games.find(x=>x.name===state.game),box=$('game-summary');box.replaceChildren();box.hidden=!g;
  if(g)for(const [label,value]of [['Потрачено на '+g.name,bagText(g.spent)],['Возвраты',bagText(g.refunds)],['Получено с продаж',bagText(g.sales)],['Куплено',g.quantity+' шт. / '+g.count+' операций']]){const block=node('div','',label);block.append(node('strong','',value));box.append(block);}
}
function renderTable(){
  const txs=filteredTransactions();
  let rows=state.view==='items'?groupItems(txs):[...txs].sort((a,b)=>(b.timestamp??-Infinity)-(a.timestamp??-Infinity)||a.order-b.order||a.source.localeCompare(b.source));
  const total=rows.length,pages=Math.max(1,Math.ceil(total/PAGE));state.page=Math.min(state.page,pages-1);
  const visible=rows.slice(state.page*PAGE,(state.page+1)*PAGE),head=node('tr');
  const labels=state.view==='items'?['Предмет / покупка','Куплено','Операций','Потрачено']:['Дата','Предмет / покупка','Количество','Сумма',''];
  for(const [i,label]of labels.entries())head.append(node('th',(state.view==='items'?i>0:i===2||i===3)?'numeric':'',label));
  $('table-head').replaceChildren(head);const body=$('table-body');body.replaceChildren();
  for(const row of visible){
    const tr=node('tr');
    if(state.view==='items'){
      const cell=node('td','name-cell');cell.append(node('span','item-name',row.name));
      const meta=node('span','item-meta',row.game+' · '+(row.sources.length===2?'Магазин и площадка':row.sources[0]==='market'?'Торговая площадка':'Магазин / в игре'));
      if(!row.detailKnown)meta.append(node('span','item-badge','без детализации'));cell.append(meta);
      tr.append(cell);const qty=node('td','numeric');qty.append(node('span','quantity','×'+row.quantity));tr.append(qty,node('td','numeric',row.count),node('td','numeric money',formatMoney(row.amountMinor,row.currency)));
    }else{
      tr.append(node('td','',row.dateText||'Дата не указана'));
      const cell=node('td','name-cell');cell.append(node('span','item-name',row.name),node('span','item-meta',row.game+' · '+(kindNames[row.kind]||row.kind)));
      tr.append(cell,node('td','numeric','×'+row.quantity));
      tr.append(node('td','numeric money'+(INCOME.has(row.kind)?' positive':''),formatMoney(row.amountMinor,row.currency)));
      const edit=node('td',''),button=node('button','edit-button','Уточнить');button.type='button';button.addEventListener('click',()=>openEdit(row.id));edit.append(button);tr.append(edit);
    }
    body.append(tr);
  }
  $('items-view').classList.toggle('selected',state.view==='items');$('history-view').classList.toggle('selected',state.view==='history');$('kind-filter').disabled=state.view==='items';
  $('empty-state').hidden=!!total;$('empty-text').textContent=rawTransactions().length?'Нет операций с выбранными фильтрами.':'Загрузи историю или открой пример.';
  $('row-count').textContent=`${total} ${state.view==='items'?'позиций':'операций'} · ${total?state.page*PAGE+1:0}–${Math.min(total,(state.page+1)*PAGE)}`;
  $('page-number').textContent=(state.page+1)+' / '+pages;$('prev-page').disabled=state.page===0;$('next-page').disabled=state.page===pages-1;
  $('csv-button').disabled=txs.length===0;$('backup-button').disabled=rawTransactions().length===0;
}
function renderDiagnostics(){
  const s=state.snapshot,box=$('diagnostics-content');box.replaceChildren();
  $('diagnostics-title').textContent=warningCount()?`Сведения о загрузке · ${warningCount()} строк требуют проверки`:'Сведения о загрузке';
  const descriptions=[`Аккаунт: ${state.demo?'демонстрационный':s.accountId}`,`Кошелёк: ${s.wallet.transactions.length} операций; ${s.wallet.complete?'вся история':'история неполная'}.`,`Площадка: ${s.market.transactions.length} покупок и продаж из ${s.market.start} просмотренных строк; ${s.market.complete?'вся история':'история неполная'}.`,'При подробной загрузке общие записи площадки из кошелька исключаются из расчёта. Пополнения и продажи не уменьшают показатель «Всего потрачено»; возвраты учитываются отдельным показателем.'];
  for(const line of descriptions)box.append(node('div','',line));
  if(state.requests.length){
    box.append(node('strong','','Последние запросы к Steam:'));
    for(const r of state.requests.slice(-20).reverse()){
      const outcome=r.outcome==='pending'?'ожидание ответа':r.outcome==='error'?'ошибка: '+r.error:'HTTP '+r.status;
      box.append(node('div','request-entry',new Date(r.time).toLocaleTimeString('ru-RU')+' · '+r.method+' '+r.url+' · попытка '+r.attempt+' · '+outcome));
    }
  }
  const originals=s.wallet.transactions.filter(t=>t.originalAmount);
  if(originals.length){const sums={};for(const t of originals){const c=t.originalAmount.currency;sums[c]=(sums[c]||0)+t.originalAmount.amountMinor;}box.append(node('div','',`Исходные суммы в другой валюте (справочно; не добавлены повторно): ${bagText(sums)}`));}
  for(const w of [...s.wallet.warnings,...s.market.warnings].slice(0,30))box.append(node('div','',`${w.date||''} ${w.name||''} — ${w.reason}`));
  if(warningCount()>30)box.append(node('div','','Полный список неразобранных строк сохранён в резервной копии.'));
}
function render(){const transactions=periodTransactions(),games=renderGames(transactions);renderStatus();renderAccess();renderSummary(transactions,games);renderTable();renderDiagnostics();}
async function refreshSteamAccess(){state.access=await readSteamAccess();renderAccess();}
async function grantAccess(){
  if(state.busy||state.accessBusy)return false;
  state.accessBusy=true;renderStatus();renderAccess();
  try{state.access=await requestSteamAccess();state.error=null;return true;}
  catch(e){state.error=e.message;return false;}
  finally{state.accessBusy=false;render();}
}
async function loadFromClick(force=false){
  if(state.busy||state.accessBusy)return;
  if(state.access?.supported&&!state.access.granted&&!await grantAccess())return;
  return load(force);
}
async function refreshAccounts(){
  const snapshots=await getSnapshots();const select=$('account-select');select.replaceChildren();
  if(!snapshots.length)select.append(new Option('Нет сохранённых аккаунтов',''));
  for(const s of snapshots.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))))select.append(new Option((s.accountId==='imported-local'?'Импорт HTML':s.accountId)+' · '+(s.wallet.transactions.length+s.market.transactions.length)+' операций',s.accountId));
  if(snapshots.some(s=>s.accountId===state.snapshot.accountId))select.value=state.snapshot.accountId;
}
async function persist(snapshot){if(snapshot.accountId==='demo')return;await saveSnapshot(snapshot);localStorage.setItem('swc-last-account',snapshot.accountId);}
async function load(force=false){
  if(state.busy)return;
  state.busy=true;state.error=null;state.progress=null;state.requests=[];state.controller=new AbortController();render();
  const collector=new SteamCollector({signal:state.controller.signal,currency:$('fallback-currency').value||null,onProgress:p=>{state.progress=p;renderStatus();},onRequest:r=>{const i=state.requests.findIndex(previous=>previous.time===r.time&&previous.url===r.url&&previous.attempt===r.attempt);if(i<0)state.requests.push(r);else state.requests[i]=r;state.requests=state.requests.slice(-40);renderDiagnostics();},onSave:async s=>{await persist(s);render();}});
  let touched=false;
  try{
    state.access=await requireSteamAccess();renderAccess();
    if(state.controller.signal.aborted)throw new DOMException('Загрузка остановлена','AbortError');
    const probe=await collector.probe();
    let cached=force?null:await getSnapshot(probe.parsed.meta.accountId);
    if(cached?.wallet.complete&&cached?.market.complete)cached=null;
    const previous=await getSnapshot(probe.parsed.meta.accountId);
    state.snapshot=cached||emptySnapshot(probe.parsed.meta.accountId);
    if(!cached&&previous?.overrides)state.snapshot.overrides=previous.overrides;
    state.demo=false;state.game=null;state.page=0;touched=true;
    await collector.collectWallet(state.snapshot,probe);
    await collector.collectMarket(state.snapshot);
  }catch(e){
    if(e.name!=='AbortError'){state.error=e.message;$('diagnostics').open=true;}
    else state.error=null;
    if(touched)await persist(state.snapshot);
  }finally{
    state.busy=false;state.controller=null;state.progress=null;await refreshAccounts();render();
  }
}
function showDemo(){state.snapshot=demoSnapshot();state.demo=true;state.game=null;state.page=0;state.error=null;render();}
function download(text,name,mime){const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function openEdit(id){
  const t=rawTransactions().find(x=>x.id===id);if(!t)return;state.editId=id;
  const f=$('edit-form');f.elements.game.value=t.game;f.elements.name.value=t.name;f.elements.quantity.value=t.quantity;$('edit-dialog').showModal();
}
async function importFile(file){
  if(!file)return;if(file.size>100*1024*1024)throw new Error('Файл слишком большой: максимум 100 МБ.');
  const text=await file.text();let data;
  if(file.name.toLowerCase().endsWith('.json'))data=validateSnapshot(JSON.parse(text));
  else {
    data=await getSnapshot('imported-local')||emptySnapshot('imported-local');
    if(/wallet_table_row|wallet_history_table/.test(text)){
      const parsed=parseWallet(text,{currency:$('fallback-currency').value||null});
      data.wallet={...data.wallet,transactions:parsed.transactions,warnings:parsed.warnings,offset:parsed.rowCount,cursor:null,complete:false,initialized:true};
    }else if(/market_recent_listing_row/.test(text)){
      const parsed=parseMarket(text,{currency:$('fallback-currency').value||null});
      data.market={...data.market,transactions:parsed.transactions,warnings:parsed.warnings,start:parsed.rowCount,expected:null,complete:false,initialized:true};
    }else throw new Error('В HTML нет таблицы истории кошелька или торговой площадки Steam.');
    data.updatedAt=new Date().toISOString();
  }
  await persist(data);state.snapshot=data;state.demo=false;state.game=null;state.page=0;state.error=null;await refreshAccounts();render();
}
function resetFilters(){state.page=0;render();}
$('overview').addEventListener('click',()=>{state.game=null;resetFilters();});
$('load-button').addEventListener('click',()=>loadFromClick());$('restart-button').addEventListener('click',()=>loadFromClick(true));
$('grant-access').addEventListener('click',grantAccess);
$('stop-button').addEventListener('click',()=>state.controller?.abort());
$('demo-button').addEventListener('click',showDemo);$('welcome-demo').addEventListener('click',showDemo);
$('items-view').addEventListener('click',()=>{state.view='items';resetFilters();});$('history-view').addEventListener('click',()=>{state.view='history';resetFilters();});
for(const id of ['source-filter','kind-filter','date-from','date-to'])$(id).addEventListener('change',resetFilters);
let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(resetFilters,120);});
$('date-button').addEventListener('click',()=>{$('date-filters').hidden=!$('date-filters').hidden;});
$('date-clear').addEventListener('click',()=>{$('date-from').value='';$('date-to').value='';resetFilters();});
$('prev-page').addEventListener('click',()=>{state.page--;renderTable();});$('next-page').addEventListener('click',()=>{state.page++;renderTable();});
$('help-button').addEventListener('click',()=>$('help-dialog').showModal());
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('csv-button').addEventListener('click',()=>download(csvExport(filteredTransactions()),'steam-transactions-'+new Date().toISOString().slice(0,10)+'.csv','text/csv;charset=utf-8'));
$('backup-button').addEventListener('click',()=>download(JSON.stringify(state.snapshot,null,2),'steam-wallet-counter-backup.json','application/json'));
$('import-button').addEventListener('click',()=>$('file-input').click());
$('file-input').addEventListener('change',async()=>{try{await importFile($('file-input').files[0]);}catch(e){state.error='Ошибка импорта: '+e.message;render();}finally{$('file-input').value='';}});
$('account-select').addEventListener('change',async()=>{const s=await getSnapshot($('account-select').value);if(s){state.snapshot=s;state.demo=false;state.game=null;state.error=null;resetFilters();localStorage.setItem('swc-last-account',s.accountId);}});
$('edit-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget,q=Number(f.elements.quantity.value);
  if(!Number.isSafeInteger(q)||q<1)return;
  state.snapshot.overrides[state.editId]={game:tidy(f.elements.game.value),name:tidy(f.elements.name.value),quantity:q};
  await persist(state.snapshot);$('edit-dialog').close();render();
});
$('reset-edit').addEventListener('click',async()=>{delete state.snapshot.overrides[state.editId];await persist(state.snapshot);$('edit-dialog').close();render();});
try{
  await refreshSteamAccess();
  const account=localStorage.getItem('swc-last-account');
  if(account){const saved=await getSnapshot(account);if(saved)state.snapshot=saved;}
  await refreshAccounts();
}catch(e){state.error='Не удалось открыть сохранённую историю: '+e.message;}
if(new URLSearchParams(location.search).get('demo')==='1')showDemo();else render();
globalThis.chrome?.permissions?.onAdded?.addListener(()=>refreshSteamAccess().catch(e=>{state.error=e.message;render();}));
globalThis.chrome?.permissions?.onRemoved?.addListener(()=>refreshSteamAccess().catch(e=>{state.error=e.message;render();}));
