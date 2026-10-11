import {emptySnapshot} from './collector.mjs';
export function demoSnapshot(){
  const data=emptySnapshot('demo');let order=0;
  const tx=(source,kind,game,name,quantity,amountMinor,date)=>({id:'demo-'+order,source,kind,game,name,quantity,amountMinor,currency:'RUB',dateText:date,timestamp:Date.parse(date+'T00:00:00Z'),order:order++,detailKnown:true,items:[]});
  data.wallet.transactions=[
    tx('wallet','ingame','Dota 2','Treasure of the Crown',40,2480000,'2026-10-10'),
    tx('wallet','ingame','Dota 2','Набор: Battle Pass + 100 уровней',1,2399900,'2026-09-27'),
    tx('wallet','ingame','Dota 2','Treasure of the Crown',20,1240000,'2026-09-20'),
    tx('wallet','ingame','Dota 2','Collector’s Cache',15,1247269,'2026-08-16'),
    tx('wallet','purchase','Elden Ring','Elden Ring',1,499900,'2026-07-11'),
    tx('wallet','purchase','Cyberpunk 2077','Cyberpunk 2077',1,399900,'2026-06-12'),
    tx('wallet','purchase','Baldur’s Gate 3','Baldur’s Gate 3',1,399900,'2026-06-11'),
    tx('wallet','ingame','Counter-Strike 2','Ключ к кейсу',25,901200,'2026-05-19'),
    tx('wallet','topup','Кошелёк Steam','Пополнение кошелька',1,7591874,'2026-05-18'),
    tx('wallet','credit','Кошелёк Steam','Прочие зачисления',1,212400,'2026-04-01')
  ];
  data.wallet.transactions.find(t=>t.kind==='topup').originalAmount={amountMinor:89327,currency:'USD'};
  data.market.transactions=[
    tx('market','market_buy','Dota 2','Treasure of the Crown',1,5811,'2026-10-10'),
    tx('market','market_buy','Dota 2','Manifold Paradox',1,250000,'2026-10-08'),
    tx('market','market_buy','Dota 2','Manifold Paradox',1,260000,'2026-09-15'),
    tx('market','market_buy','Dota 2','Treasure of the Crown',1,10000,'2026-09-01'),
    tx('market','market_buy','Counter-Strike 2','AK-47 | Redline',1,310000,'2026-08-17'),
    tx('market','market_buy','Team Fortress 2','Mann Co. Supply Crate Key',1,80000,'2026-07-21'),
    tx('market','market_sell','Dota 2','Dragonclaw Hook',1,1314635,'2026-10-09'),
    tx('market','market_sell','Counter-Strike 2','AWP | Asiimov',1,500000,'2026-09-28')
  ];
  data.wallet.complete=true;data.market.complete=true;data.market.expected=8;data.market.start=8;data.updatedAt=new Date().toISOString();
  return data;
}
