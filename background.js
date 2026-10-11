chrome.action.onClicked.addListener(async()=>{
  const url=chrome.runtime.getURL('dashboard.html');
  const existing=await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[url]});
  if(existing[0]?.tabId>=0){await chrome.tabs.update(existing[0].tabId,{active:true});await chrome.windows.update(existing[0].windowId,{focused:true});}
  else await chrome.tabs.create({url});
});
