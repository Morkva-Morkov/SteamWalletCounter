// Money is stored in integer minor units. No exchange-rate estimates enter totals.
export const VERSION = 2;
export const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
export const THREE_DECIMAL = new Set(['KWD', 'BHD', 'JOD', 'OMR', 'TND']);
export const CURRENCY_IDS = {
  1:'USD',2:'GBP',3:'EUR',4:'CHF',5:'RUB',6:'PLN',7:'BRL',8:'JPY',9:'NOK',10:'IDR',
  11:'MYR',12:'PHP',13:'SGD',14:'THB',15:'VND',16:'KRW',17:'TRY',18:'UAH',19:'MXN',
  20:'CAD',21:'AUD',22:'NZD',23:'CNY',24:'INR',25:'CLP',26:'PEN',27:'COP',28:'ZAR',
  29:'HKD',30:'TWD',31:'SAR',32:'AED',33:'SEK',34:'ARS',35:'ILS',36:'BYN',37:'KZT',
  38:'KWD',39:'QAR',40:'CRC',41:'UYU',42:'BGN',43:'HRK',44:'CZK',45:'DKK',46:'HUF',47:'RON'
};
export const SPEND = new Set(['purchase','ingame','gift','other_spend','market_buy','market_summary_buy']);
export const INCOME = new Set(['topup','credit','refund','market_sell','market_summary_sell']);
export const GAME_NAMES = {'570':'Dota 2','730':'Counter-Strike 2','440':'Team Fortress 2','753':'Steam','578080':'PUBG: BATTLEGROUNDS','252490':'Rust'};
export const digits = currency => ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2;
export const tidy = value => String(value ?? '').replace(/[\u00a0\u202f\t\r\n ]+/g, ' ').trim();
export function canonicalGame(value, appid = '') {
  const text = tidy(value);
  if (/^dota\s*2$/i.test(text) || String(appid) === '570') return 'Dota 2';
  if (/^counter-strike(?::?\s*(2|global offensive))?$/i.test(text) || String(appid) === '730') return 'Counter-Strike 2';
  return text || GAME_NAMES[appid] || 'Без привязки к игре';
}

export function detectCurrency(text, fallback = null) {
  const t = tidy(text);
  const code = t.match(/\b(USD|GBP|EUR|CHF|RUB|PLN|BRL|JPY|NOK|IDR|MYR|PHP|SGD|THB|VND|KRW|TRY|UAH|MXN|CAD|AUD|NZD|CNY|INR|CLP|PEN|COP|ZAR|HKD|TWD|SAR|AED|SEK|ARS|ILS|BYN|KZT|KWD|QAR|CRC|UYU|BGN|HRK|CZK|DKK|HUF|RON)\b/i);
  if (code) return code[1].toUpperCase();
  const rules = [
    [/CDN\$|C\$|CA\$/i,'CAD'],[/A\$|AU\$/i,'AUD'],[/NZ\$/i,'NZD'],[/HK\$/i,'HKD'],[/S\$|SG\$/i,'SGD'],[/NT\$/i,'TWD'],[/R\$/i,'BRL'],
    [/₽|руб\.?|pуб\.?/i,'RUB'],[/€/,'EUR'],[/£/,'GBP'],[/zł/i,'PLN'],[/₴/,'UAH'],[/₸/,'KZT'],[/₹|Rs\.?/i,'INR'],[/₩/,'KRW'],[/₫/,'VND'],[/₱/,'PHP'],[/฿/,'THB'],[/₺|TL\b/i,'TRY'],[/RMB|CN¥/i,'CNY'],[/RM\b/i,'MYR'],[/Rp\b/i,'IDR'],[/₪/,'ILS'],[/CHF/i,'CHF']
  ];
  for (const [pattern,currency] of rules) if (pattern.test(t)) return currency;
  if (/[¥￥]/.test(t)) return fallback === 'JPY' || fallback === 'CNY' ? fallback : null;
  // A bare dollar sign does not identify USD. The account currency supplies context.
  if (/\$/.test(t)) return fallback && ['USD','CAD','AUD','NZD','SGD','HKD','TWD','MXN','ARS','CLP','COP','UYU'].includes(fallback) ? fallback : null;
  return fallback;
}

export function parseMoney(text, fallback = null) {
  const raw = tidy(text).replace(/[−–]/g,'-');
  if (!raw || /^[-—]+$/.test(raw)) return null;
  // Ignore parenthetical converted values here; callers may read those separately.
  const main = raw.replace(/\([^)]*\)/g,'').trim();
  const token = main.match(/[+-]?\s*\d[\d\s.,'’]*/);
  if (!token) return null;
  const currency = detectCurrency(main, fallback);
  if (!currency) return null;
  let number = token[0].replace(/[\s'’]/g,'');
  const sign = number.startsWith('-') ? -1 : 1;
  number = number.replace(/^[+-]/,'');
  const precision = digits(currency);
  const lastDot = number.lastIndexOf('.'), lastComma = number.lastIndexOf(',');
  let decimal = -1;
  if (precision > 0) {
    if (lastDot >= 0 && lastComma >= 0) decimal = Math.max(lastDot,lastComma);
    else {
      const candidate = Math.max(lastDot,lastComma);
      if (candidate >= 0 && number.length - candidate - 1 <= precision) decimal = candidate;
    }
  }
  const whole = (decimal >= 0 ? number.slice(0,decimal) : number).replace(/[.,]/g,'');
  const fraction = decimal >= 0 ? number.slice(decimal+1).replace(/[.,]/g,'') : '';
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > precision) return null;
  const amountMinor = sign * (Number(whole) * 10 ** precision + Number(fraction.padEnd(precision,'0') || 0));
  if (!Number.isSafeInteger(amountMinor)) return null;
  return {amountMinor,currency,raw};
}
export function formatMoney(amountMinor, currency, locale = 'ru-RU') {
  return new Intl.NumberFormat(locale,{minimumFractionDigits:digits(currency),maximumFractionDigits:digits(currency)}).format(amountMinor / 10 ** digits(currency)) + ' ' + currency;
}
export function addMoney(bag, currency, amountMinor) {
  if (!Number.isSafeInteger(amountMinor)) return;
  bag[currency] = (bag[currency] || 0) + amountMinor;
  if (!Number.isSafeInteger(bag[currency])) throw new Error('Сумма превышает безопасный диапазон.');
}
export function subtractBags(a,b) {
  const out = {...a}; for (const [c,n] of Object.entries(b)) addMoney(out,c,-n); return out;
}
export function parseQuantity(text) {
  let name = tidy(text), quantity = 1;
  // Deliberately do not interpret digits inside item names (Dota 2 / 2026).
  let match = name.match(/^(\d+)\s*[x×]\s+(.+)$/i);
  if (match) {quantity=Number(match[1]);name=match[2];}
  else if ((match=name.match(/^(.+?)\s+[x×]\s*(\d+)$/i))) {name=match[1];quantity=Number(match[2]);}
  else if ((match=name.match(/^(.+?)\s*\((?:quantity|количество|qty)\s*:?\s*(\d+)\)$/i))) {name=match[1];quantity=Number(match[2]);}
  return {name:tidy(name),quantity:Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100000000 ? quantity : 1};
}

const MONTHS = {
  jan:0,january:0,янв:0,января:0,janv:0,januar:0,
  feb:1,february:1,фев:1,февраля:1,februar:1,
  mar:2,march:2,мар:2,марта:2,märz:2,
  apr:3,april:3,апр:3,апреля:3,
  may:4,май:4,мая:4,mai:4,
  jun:5,june:5,июн:5,июня:5,juni:5,
  jul:6,july:6,июл:6,июля:6,juli:6,
  aug:7,august:7,авг:7,августа:7,
  sep:8,sept:8,september:8,сен:8,сент:8,сентября:8,
  oct:9,october:9,окт:9,октября:9,okt:9,oktober:9,
  nov:10,november:10,ноя:10,нояб:10,ноября:10,
  dec:11,december:11,дек:11,декабря:11,dez:11,dezember:11
};
export function parseDate(text) {
  const s = tidy(text).toLowerCase().replace(/[,\.]/g,' ').replace(/\s+/g,' ');
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return Date.UTC(+match[1],+match[2]-1,+match[3]);
  match = tidy(text).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (match) return Date.UTC(+match[3],+match[2]-1,+match[1]);
  const parts = s.split(' ').filter(Boolean);
  const monthIndex = parts.findIndex(p => MONTHS[p] !== undefined);
  if (monthIndex >= 0) {
    const year = parts.find(p => /^20\d\d$|^19\d\d$/.test(p));
    const day = parts.find(p => /^\d{1,2}$/.test(p));
    if (year && day) return Date.UTC(+year,MONTHS[parts[monthIndex]],+day);
  }
  return null;
}
export function fingerprint(parts) {
  const text = parts.map(x=>String(x??'')).join('\u001f');
  let a=2166136261,b=5381;
  for (let i=0;i<text.length;i++) {a=Math.imul(a ^ text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}
  return (a>>>0).toString(16)+(b>>>0).toString(16);
}
export function mergeTransactions(previous,incoming) {
  const map = new Map(previous.map(t=>[t.id,t]));
  for (const tx of incoming) map.set(tx.id,tx);
  return [...map.values()];
}
export function ledger(snapshot) {
  const market = snapshot.market?.transactions || [];
  // Detailed market rows replace the wallet's market aggregates, never add to them.
  const detailed = market.length > 0 || snapshot.market?.complete === true;
  const wallet = (snapshot.wallet?.transactions || []).filter(t=>!detailed || !t.kind.startsWith('market_summary'));
  return [...wallet,...market];
}
export function inDateRange(t,from,to) {
  if (!from && !to) return true;
  if (t.timestamp === null || t.timestamp === undefined) return false;
  return (!from || t.timestamp >= Date.parse(from+'T00:00:00Z')) && (!to || t.timestamp < Date.parse(to+'T00:00:00Z')+86400000);
}
export function summarize(transactions) {
  const s = {spent:{},received:{},marketSpent:{},marketReceived:{},purchases:{},topups:{},refunds:{},otherIncome:{},otherSpent:{},topupRefunds:{},unknown:0,count:transactions.length};
  for (const t of transactions) {
    const n=t.amountMinor,c=t.currency;
    if (SPEND.has(t.kind)) addMoney(s.spent,c,n);
    if (INCOME.has(t.kind)) addMoney(s.received,c,n);
    if (t.kind==='market_buy'||t.kind==='market_summary_buy') addMoney(s.marketSpent,c,n);
    else if (t.kind==='market_sell'||t.kind==='market_summary_sell') addMoney(s.marketReceived,c,n);
    else if (['purchase','ingame','gift'].includes(t.kind)) addMoney(s.purchases,c,n);
    else if (t.kind==='topup') addMoney(s.topups,c,n);
    else if (t.kind==='refund') addMoney(s.refunds,c,n);
    else if (t.kind==='credit') addMoney(s.otherIncome,c,n);
    else if (t.kind==='other_spend') addMoney(s.otherSpent,c,n);
    else if (t.kind==='topup_refund') {addMoney(s.topupRefunds,c,n);}
    else if (t.kind==='unknown') s.unknown++;
  }
  s.netSpent=subtractBags(s.spent,s.refunds);
  return s;
}
export function groupGames(transactions) {
  const games=new Map();
  for(const t of transactions) {
    if(!SPEND.has(t.kind)&&!['refund','market_sell','market_summary_sell'].includes(t.kind)) continue;
    const key=t.game||'Без привязки к игре';
    if(!games.has(key)) games.set(key,{name:key,transactions:[],spent:{},refunds:{},sales:{},quantity:0,count:0});
    const g=games.get(key);g.transactions.push(t);
    if(SPEND.has(t.kind)){addMoney(g.spent,t.currency,t.amountMinor);g.quantity+=t.quantity;g.count++;}
    else if(t.kind==='refund')addMoney(g.refunds,t.currency,t.amountMinor);
    else addMoney(g.sales,t.currency,t.amountMinor);
  }
  return [...games.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
export function groupItems(transactions) {
  const groups=new Map();
  for(const t of transactions) {
    if(!SPEND.has(t.kind))continue;
    // Currency is part of the key; unlike currencies are never added.
    const key=[t.game,t.name,t.currency].join('\u001f');
    if(!groups.has(key))groups.set(key,{key,game:t.game,name:t.name,currency:t.currency,quantity:0,amountMinor:0,count:0,sources:new Set(),detailKnown:t.detailKnown!==false});
    const g=groups.get(key);g.quantity+=t.quantity;g.amountMinor+=t.amountMinor;g.count++;g.sources.add(t.source);
  }
  return [...groups.values()].map(g=>({...g,sources:[...g.sources]})).sort((a,b)=>a.currency.localeCompare(b.currency)||b.amountMinor-a.amountMinor);
}
export function applyOverrides(transactions,overrides={}) {
  return transactions.map(t=>{
    const edit=overrides[t.id];if(!edit)return t;
    return {...t,game:canonicalGame(edit.game||t.game),name:tidy(edit.name||t.name),quantity:Number.isSafeInteger(edit.quantity)&&edit.quantity>0?edit.quantity:t.quantity,detailKnown:true};
  });
}
export function validateSnapshot(data) {
  if(!data || data.version!==VERSION || typeof data.accountId!=='string') throw new Error('Это не файл резервной копии Steam Wallet Counter 2.');
  const kinds=new Set([...SPEND,...INCOME,'unknown','conversion','topup_refund']);
  for(const source of ['wallet','market']) {
    const part=data[source];
    if(!part||!Array.isArray(part.transactions)||part.transactions.length>500000)throw new Error('Некорректный список операций.');
    if(!Array.isArray(part.warnings)||typeof part.complete!=='boolean')throw new Error('В резервной копии нет сведений о полноте истории.');
    for(const t of part.transactions){
      if(typeof t.id!=='string'||t.source!==source||!kinds.has(t.kind)||!Number.isSafeInteger(t.amountMinor)||t.amountMinor<0||!Number.isSafeInteger(t.quantity)||t.quantity<1||typeof t.currency!=='string'||!/^[A-Z]{3}$/.test(t.currency)||typeof t.name!=='string'||typeof t.game!=='string'||t.name.length>10000||t.game.length>1000||(t.timestamp!==null&&t.timestamp!==undefined&&!Number.isFinite(t.timestamp)))throw new Error('В резервной копии обнаружена некорректная операция.');
    }
  }
  if(!data.overrides||typeof data.overrides!=='object'||Array.isArray(data.overrides))data.overrides={};
  for(const edit of Object.values(data.overrides))if(!edit||typeof edit.name!=='string'||typeof edit.game!=='string'||edit.name.length>10000||edit.game.length>1000||!Number.isSafeInteger(edit.quantity)||edit.quantity<1)throw new Error('Некорректное ручное уточнение покупки.');
  return data;
}
export function csvExport(transactions) {
  const protect=v=>{
    let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  const rows=[['Дата','Игра','Предмет / покупка','Количество','Сумма','Валюта','Тип','Источник','ID']];
  for(const t of transactions)rows.push([t.dateText,t.game,t.name,t.quantity,(t.amountMinor/10**digits(t.currency)).toFixed(digits(t.currency)),t.currency,t.kind,t.source,t.id]);
  return '\uFEFF'+rows.map(row=>row.map(protect).join(';')).join('\r\n');
}
