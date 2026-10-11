export const STEAM_HOSTS=['https://store.steampowered.com/*','https://steamcommunity.com/*'];

export async function readSteamAccess(api=globalThis.chrome) {
  if(!api?.runtime?.id||!api.permissions?.contains)return {supported:false,granted:false,missing:[],hosts:[]};
  const hosts=await Promise.all(STEAM_HOSTS.map(async origin=>({origin,granted:await api.permissions.contains({origins:[origin]})})));
  const missing=hosts.filter(host=>!host.granted).map(host=>host.origin);
  return {supported:true,granted:missing.length===0,missing,hosts};
}

export async function requireSteamAccess(api=globalThis.chrome) {
  const access=await readSteamAccess(api);
  if(!access.supported)throw new Error('Для загрузки Steam открой эту страницу через установленное расширение.');
  if(!access.granted)throw new Error('Нет доступа к '+access.missing.map(origin=>new URL(origin).hostname).join(' и ')+'. Нажми «Разрешить доступ к Steam».');
  return access;
}

export async function requestSteamAccess(api=globalThis.chrome) {
  if(!api?.runtime?.id||!api.permissions?.request)throw new Error('Запрос доступа доступен только в установленном расширении.');
  // Invoke request before any await so the user's button click is preserved.
  let granted;
  try {granted=await api.permissions.request({origins:STEAM_HOSTS});}
  catch(e){throw new Error('Браузер не предоставил доступ к Steam: '+e.message+'. В настройках расширения разреши доступ к обоим сайтам Steam.');}
  if(!granted)throw new Error('Доступ к Steam не разрешён. Разреши доступ к обоим сайтам в настройках расширения и повтори загрузку.');
  return requireSteamAccess(api);
}
