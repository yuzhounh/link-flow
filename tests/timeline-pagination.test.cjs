const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../static/js/app.js'),'utf8');
function between(a,b){const from=source.indexOf(a),to=source.indexOf(b,from);assert.ok(from>=0&&to>from);return source.slice(from,to);}
class Node {
  constructor(){this.children=[];this.className='';this.scrollTop=70;this.classList={contains:name=>this.className.split(' ').includes(name)};}
  appendChild(node){node.parent=this;this.children.push(node);return node;}
  prepend(node){const nodes=node.fragment?node.children:[node];for(const n of nodes)n.parent=this;this.children.unshift(...nodes);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
  querySelector(selector){return this.children.find(n=>n.classList.contains(selector.slice(1)))||null;}
  get firstElementChild(){return this.children[0]||null;}
  get scrollHeight(){return this.children.reduce((n,c)=>n+(c.classList.contains('timeline-date-divider')?20:80),0);}
  scrollTo({top}){this.scrollTop=top;}
}
function fixture(){
 const chatHistory=new Node();const first={id:'z',timestamp:new Date(2026,8,5,10).getTime()};
 const ctx=vm.createContext({chatHistory,allMessages:[first],currentViewMonth:'2026-09',PAGE_SIZE:30,hasMoreOlder:true,loadingOlder:false,loadingView:false,timelineSeq:0,olderController:null,viewController:null,searchInput:{value:''},AbortController,AbortSignal,console,document:{createElement:()=>new Node(),createDocumentFragment:()=>Object.assign(new Node(),{fragment:true})},formatDateHeader:ts=>new Date(ts).toDateString(),appendMessageToUI:(msg,scroll,target=chatHistory)=>{const row=new Node();row.id=msg.id;target.appendChild(row);}});
 vm.runInContext(between('  function cancelTimelineRequests()','  // Prepends')+between('  async function loadOlderMessages()','  // A short page')+between('  function updateTopHint()','  function formatFileSize'),ctx);
 const divider=new Node();divider.className='timeline-date-divider';chatHistory.appendChild(divider);const existing=new Node();existing.id=first.id;existing.downloadState='in progress';chatHistory.appendChild(existing);
 return{ctx,first,existing,chatHistory};
}
test('older page preserves existing cards and merges the boundary date divider with a stable scroll anchor',()=>{
 const {ctx,first,existing,chatHistory}=fixture();const height=chatHistory.scrollHeight;
 ctx.page=[{id:'a',timestamp:first.timestamp-86400000},{id:'b',timestamp:first.timestamp-1}];
 vm.runInContext('prependMessages(page)',ctx);
 assert.equal(chatHistory.children.at(-1),existing);assert.equal(existing.downloadState,'in progress');
 assert.equal(chatHistory.children.filter(n=>n.classList.contains('timeline-date-divider')).length,2);
 assert.equal(chatHistory.scrollTop,70+chatHistory.scrollHeight-height);
 assert.deepEqual(chatHistory.children.filter(n=>n.id).map(n=>n.id),['a','b','z']);
});
test('month pagination carries both cursor fields, deduplicates rows and marks the end',async()=>{
 const {ctx,first,existing,chatHistory}=fixture();let url;
 ctx.apiFetch=async value=>{url=value;return{json:async()=>({status:'ok',messages:[{id:'a',timestamp:first.timestamp-1},first]})};};
 assert.equal(await vm.runInContext('loadOlderMessages()',ctx),true);
 assert.match(url,/before_id=z/);assert.match(url,/month=2026-09/);
 assert.deepEqual(Array.from(ctx.allMessages,x=>x.id),['a','z']);assert.equal(ctx.hasMoreOlder,false);
 assert.equal(chatHistory.children.at(-1),existing);assert.ok(chatHistory.querySelector('.timeline-top-hint'));
});
test('a late older-page response cannot replace a newer month or search and cancellation releases loading',async()=>{
 const {ctx}=fixture();let finish;ctx.apiFetch=()=>new Promise(resolve=>finish=resolve);
 const loading=vm.runInContext('loadOlderMessages()',ctx);
 vm.runInContext("cancelTimelineRequests(); currentViewMonth='2026-10'; allMessages=[{id:'new',timestamp:1}]",ctx);
 finish({json:async()=>({status:'ok',messages:[{id:'stale',timestamp:0}]})});
 assert.equal(await loading,false);assert.deepEqual(Array.from(ctx.allMessages,x=>x.id),['new']);assert.equal(ctx.loadingOlder,false);
 ctx.searchInput.value='needle';assert.equal(await vm.runInContext('loadOlderMessages()',ctx),false);
});
