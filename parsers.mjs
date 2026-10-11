import {CURRENCY_IDS,GAME_NAMES,tidy,parseMoney,parseDate,parseQuantity,canonicalGame,fingerprint} from './core.mjs';

export function parseDocument(html) {return new DOMParser().parseFromString(html,'text/html');}
const text=(root,selector)=>tidy(root.querySelector(selector)?.textContent);
const lines=node=>{
  if(!node)return [];
  const copy=node.cloneNode(true);
  copy.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));
  copy.querySelectorAll('div,p,li').forEach(n=>n.append('\n'));
  return copy.textContent.split('\n').map(tidy).filter(Boolean);
};
// Read a JSON literal from a script assignment without evaluating page JavaScript.
export function jsonAssignment(html,name) {
  const pattern=new RegExp('\\b'+name+'\\s*=\\s*','g');
  let match;
  while((match=pattern.exec(html))) {
    let i=pattern.lastIndex;
    if(html.slice(i,i+4)==='null')return {found:true,value:null};
    if(!['{','['].includes(html[i]))continue;
    const begin=i;let depth=0,quoted=false,escaped=false;
    for(;i<html.length;i++) {
      const c=html[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='{'||c==='[')depth++;
      else if(c==='}'||c===']'){
        depth--;if(depth===0){try{return {found:true,value:JSON.parse(html.slice(begin,i+1))};}catch{break;}}
      }
    }
  }
  return {found:false,value:null};
}
const STEAM_USER_BASE=76561197960265728n;
const MAX_ACCOUNT_ID=4294967295n;
function steamId(value,short=false) {
  // SteamID64 is larger than Number.MAX_SAFE_INTEGER: preserve its exact string.
  if(typeof value==='number'&&(!short||!Number.isSafeInteger(value)))return null;
  if(!/^\d+$/.test(String(value??'')))return null;
  const n=BigInt(value);
  if(short)return n>0n&&n<=MAX_ACCOUNT_ID?String(STEAM_USER_BASE+n):null;
  return n>STEAM_USER_BASE&&n<=STEAM_USER_BASE+MAX_ACCOUNT_ID?String(n):null;
}
function attributeJson(node,name) {
  try {const value=JSON.parse(node?.getAttribute(name)||'null');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
}
function currentAccount(doc) {
  const application=doc.querySelector('#application_config');
  const user=attributeJson(application,'data-userinfo');
  if(user.logged_in===false||user.logged_in===0||user.logged_in==='false')return {accountId:null,accountSource:null};
  const candidates=new Map();
  const add=(value,source,short=false)=>{
    const id=steamId(value,short);
    if(id){if(!candidates.has(id))candidates.set(id,new Set());candidates.get(id).add(source);}
  };
  add(user.steamid,'Steam userinfo');add(user.accountid,'Steam userinfo AccountID',true);
  // Only inspect script elements, never item names or arbitrary profile links.
  for(const script of doc.querySelectorAll('script')){
    for(const match of script.textContent.matchAll(/\bg_steamID\s*=\s*(?:["'](\d+)["']|(\d+)(?=\s*[;,\r\n]|$))/g))add(match[1]||match[2],'g_steamID');
    for(const match of script.textContent.matchAll(/\bg_AccountID\s*=\s*(?:["'](\d+)["']|(\d+)(?=\s*[;,\r\n]|$))/g))add(match[1]||match[2],'g_AccountID',true);
  }
  // Restrict fallbacks to the signed-in user's avatar/menu in Steam's header.
  for(const link of doc.querySelectorAll('#global_actions a.user_avatar,#global_header a.user_avatar,#account_dropdown a[href]')){
    add(link.getAttribute('data-miniprofile'),'аватар аккаунта',true);
    const href=link.getAttribute('href');
    if(!href)continue;
    try{
      const url=new URL(href,'https://steamcommunity.com/');
      if(url.hostname==='steamcommunity.com')add(url.pathname.match(/^\/profiles\/(\d+)(?:\/|$)/)?.[1],'ссылка профиля аккаунта');
    }catch{}
  }
  if(candidates.size>1)throw new Error('Steam указал разные аккаунты в данных страницы. Загрузка остановлена, чтобы не смешать историю.');
  const id=[...candidates.keys()][0]||null;
  return {accountId:id,accountSource:id?[...candidates.get(id)].join(', '):null};
}
export function pageMeta(html,doc=null,fallbackCurrency=null) {
  doc??=parseDocument(html);
  const account=currentAccount(doc);
  const scripts=[...doc.querySelectorAll('script')].map(script=>script.textContent).join('\n');
  const sessionMatch=scripts.match(/\bg_sessionID\s*=\s*["']([a-zA-Z0-9]+)["']/);
  const config=attributeJson(doc.querySelector('#application_config'),'data-config');
  const sessionId=sessionMatch?.[1]||(typeof config.SESSIONID==='string'?config.SESSIONID:null);
  const walletInfo=jsonAssignment(html,'g_rgWalletInfo');
  let currency=CURRENCY_IDS[walletInfo.value?.wallet_currency]||fallbackCurrency;
  if(!currency&&doc){
    const tally=new Map();
    for(const n of [...doc.querySelectorAll('.wht_wallet_change,.wht_wallet_balance,.market_listing_price,.wht_total')].slice(0,200)){
      const parsed=parseMoney(n.textContent);if(parsed)tally.set(parsed.currency,(tally.get(parsed.currency)||0)+1);
    }
    currency=[...tally.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  }
  return {...account,sessionId,currency,cursor:jsonAssignment(html,'g_historyCursor')};
}
function receiptId(row){
  const attrs=[row.getAttribute('onclick'),...Array.from(row.querySelectorAll('a[href]'),a=>a.getAttribute('href'))].filter(Boolean).join(' ');
  return attrs.match(/(?:transid|transactionid)=(\d+)/i)?.[1]||row.dataset.transactionid||null;
}
function detectGame(name,itemsNode){
  const href=itemsNode?.querySelector('a[href*="/app/"]')?.getAttribute('href')||'';
  const appid=href.match(/\/app\/(\d+)/)?.[1]||'';
  return canonicalGame(name,appid);
}
function moneyIn(node,fallback){
  if(!node)return null;
  // Steam may show the original and converted total in separate blocks.
  for(const line of lines(node)) {const m=parseMoney(line,fallback);if(m)return m;}
  return parseMoney(node.textContent,fallback);
}

export function parseWallet(html,{currency=null,offset=0}={}) {
  // The continuation endpoint returns bare <tr> fragments. A normal HTML body
  // would discard their table structure, so parse them inside an inert table.
  const wrapped=/<(?:html|table)\b/i.test(html)?html:'<table class="wallet_history_table">'+html+'</table>';
  const doc=parseDocument(wrapped),meta=pageMeta(html,doc,currency),transactions=[],warnings=[];
  const rows=[...doc.querySelectorAll('.wallet_table_row')];
  for(let index=0;index<rows.length;index++){
    const row=rows[index],itemsNode=row.querySelector('.wht_items');
    if(!itemsNode)continue;
    const typeNode=row.querySelector('.wht_type'),type=text(row,'.wht_type > div:first-child')||tidy(typeNode?.textContent);
    const itemLines=lines(itemsNode);
    const all=tidy(itemsNode.textContent+' '+type).toLowerCase();
    const change=moneyIn(row.querySelector('.wht_wallet_change'),meta.currency);
    const total=moneyIn(row.querySelector('.wht_total'),meta.currency);
    const money=total||change;
    if(!money){warnings.push({row:offset+index,date:text(row,'.wht_date'),name:tidy(itemsNode.textContent),reason:'Не удалось определить сумму или валюту'});continue;}
    const refunded=!!row.querySelector('.wth_item_refunded')||/refund|возврат|rückerstattung/.test(type.toLowerCase());
    const market=/community market|торгов(ая|ой|ую) площад|markttransaktion|communitymarkt/.test(all)||/steamcommunity\.com\/market/.test(row.getAttribute('onclick')||'');
    const topup=/wallet (funds|credit)|add(ed)? funds|кошел[её]к|кошельк|пополнени|guthaben|充值/.test(all)&&!market;
    const ingame=/in[ -]?game|внутриигров|покупк[аи] в игре|spielinterne/.test(type.toLowerCase());
    const gift=/gift|подар|geschenk/.test(type.toLowerCase())||!!itemsNode.querySelector('.wth_payment > div');
    let kind;
    if(market)kind=(change?.amountMinor??money.amountMinor)<0?'market_summary_buy':'market_summary_sell';
    else if(topup)kind=refunded?'topup_refund':'topup';
    else if(refunded)kind='refund';
    else if(ingame)kind='ingame';
    else if(gift)kind='gift';
    else if(/conversion|конвертац|umrechnung/.test(all))kind='conversion';
    else if(change&&change.amountMinor>0)kind='credit';
    else if(/purchase|покупк|kauf|subscription|подписк/.test(type.toLowerCase()))kind='purchase';
    else if(change&&change.amountMinor<0)kind='other_spend';
    else kind='unknown';
    let amount=money;
    let original=null;
    // A top-up's original payment and actual wallet credit describe one event.
    if(['topup','topup_refund','credit','market_summary_buy','market_summary_sell','conversion'].includes(kind)&&change){amount=change;if(total&&total.currency!==change.currency)original=total;}
    if(amount.amountMinor===0&&kind!=='unknown'&&kind!=='conversion')continue;
    const topNames=[...itemsNode.children].filter(n=>!n.classList.contains('wth_payment')&&!n.classList.contains('wth_item_refunded')).map(n=>tidy(n.textContent)).filter(Boolean);
    let game,name,quantity=1,detailKnown=true,itemDetails=[];
    if(market){game='Торговая площадка — без детализации';name='Операции торговой площадки';detailKnown=false;}
    else if(topup||kind==='credit'||kind==='conversion'){game='Кошелёк Steam';name=itemLines[0]||'Пополнение';}
    else if(ingame || (itemsNode.querySelector('.wth_payment')&&!gift)){
      game=detectGame(topNames[0]||itemLines[0],itemsNode);
      const detailLines=lines(itemsNode.querySelector('.wth_payment')).filter(s=>!/^(refunded|возвращено|refund)$/i.test(s));
      itemDetails=detailLines.map(parseQuantity);
      if(itemDetails.length===1){({name,quantity}=itemDetails[0]);}
      else if(itemDetails.length>1){name='Набор: '+itemDetails.map(i=>i.name+' ×'+i.quantity).join(' + ');quantity=1;}
      else{name='Покупка в игре — без названия предмета';detailKnown=false;}
    }else{
      const names=topNames.length?topNames:itemLines.filter(s=>!/refund|возврат|rückerstattung/i.test(s));
      if(names.length>1){game='Покупки нескольких игр';name='Набор: '+names.join(' + ');detailKnown=false;}
      else{name=names[0]||'Покупка Steam';game=detectGame(name,itemsNode);}
    }
    const dateText=text(row,'.wht_date');
    const reference=receiptId(row);
    const key=reference?'receipt:'+fingerprint([reference,kind,dateText,name,amount.currency]):'wallet-row:'+fingerprint([offset+index,dateText,kind,name,amount.raw]);
    transactions.push({id:key,source:'wallet',kind,game,name,quantity,amountMinor:Math.abs(amount.amountMinor),currency:amount.currency,dateText,timestamp:parseDate(dateText),order:offset+index,reference,detailKnown,items:itemDetails,originalAmount:original?{amountMinor:Math.abs(original.amountMinor),currency:original.currency}:null});
  }
  // Link refunds back to the game's name when the row supplies it; later passes
  // can resolve a missing name using a receipt shared with the original purchase.
  return {transactions,warnings,rowCount:rows.length,meta,hasTable:!!doc.querySelector('.wallet_history_table,.wallet_table_row'),hasMoreButton:!!doc.querySelector('#load_more_button:not([style*="display: none"])')};
}

export function parseMarket(html,{currency=null,offset=0,assets={},hovers=''}={}) {
  const doc=parseDocument(html),transactions=[],warnings=[],rows=[...doc.querySelectorAll('.market_listing_row.market_recent_listing_row')];
  const hoverApps=new Map();
  const hoverPattern=/CreateItemHoverFromContainer\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*,/g;
  let match;while((match=hoverPattern.exec(hovers)))hoverApps.set(match[1],match[2]);
  const assetsByName=new Map();
  for(const [appid,contexts] of Object.entries(assets||{}))for(const entries of Object.values(contexts||{}))for(const asset of Object.values(entries||{})){
    if(asset&&typeof asset==='object'&&(asset.name||asset.market_hash_name))assetsByName.set(tidy(asset.name||asset.market_hash_name),{...asset,appid:asset.appid||appid});
  }
  for(let index=0;index<rows.length;index++){
    const row=rows[index];
    const action=text(row,'.market_listing_gainorloss').replace(/[−–]/g,'-');
    // The symbol is the inventory gain/loss: + means bought, - means sold.
    if(action!=='+'&&action!=='-')continue; // cancelled/created listings are not purchases
    const name=text(row,'.market_listing_item_name');
    const asset=assetsByName.get(name);
    const link=row.querySelector('a[href*="/market/listings/"]')?.getAttribute('href')||'';
    const element=row.querySelector('.market_listing_item_name')||row.querySelector('.market_listing_item_img');
    const appid=link.match(/\/market\/listings\/(\d+)\//)?.[1]||hoverApps.get(element?.id)||String(asset?.appid||'');
    const game=canonicalGame(text(row,'.market_listing_game_name')||GAME_NAMES[appid],appid);
    const price=row.querySelector('.market_listing_price');
    const cash=moneyIn(price,currency);
    if(!cash){warnings.push({row:offset+index,name,reason:'Не удалось определить сумму или валюту'});continue;}
    const dateNodes=[...row.querySelectorAll('.market_listing_listed_date')];
    const dateText=tidy(dateNodes.at(-1)?.textContent)||text(row,'.market_listing_date');
    const explicit=row.id||row.dataset.listingid||element?.id;
    const id=explicit?'market:'+fingerprint([explicit,action,dateText,cash.raw]):'market-row:'+fingerprint([offset+index,name,action,dateText,cash.raw]);
    transactions.push({id,source:'market',kind:action==='+'?'market_buy':'market_sell',game,name:name||'Предмет без названия',quantity:1,amountMinor:Math.abs(cash.amountMinor),currency:cash.currency,dateText,timestamp:parseDate(dateText),order:offset+index,reference:explicit||null,detailKnown:!!name,items:[]});
  }
  return {transactions,warnings,rowCount:rows.length};
}
