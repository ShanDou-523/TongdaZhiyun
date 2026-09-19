const api = require('../../utils/api');
Page({ data:{ items:[], content:'', busy:false, loading:true, error:'', more:false, bottom:'', myId:'' },
 onLoad(o) { this.roomId = o.id; this.pending = null; },
 onShow() { this.visible = true; this.start(); }, onHide(){this.stop();}, onUnload(){this.stop();}, stop(){this.visible=false;clearTimeout(this.timer);},
 async start(){try{const me=await api.guard(['customer','store']);if(!me)return;this.setData({myId:me.user._id});await this.refresh();}catch(e){this.setData({error:e.message,loading:false});}},
 display(items) { return items.map(x=>({...x,mine:x.senderId===this.data.myId,time:api.time(x.createdAt)})); },
 async refresh(){
  if(this.refreshing)return;
  this.refreshing=true;
  clearTimeout(this.timer);
  try { const r=await api.call('chat.messages',{roomId:this.roomId});
    const old=this.data.items, latest=old.length?old[old.length-1].seq:0;
    // If more than a page arrived while hidden, discard old slice instead of showing a silent gap.
    const gap=old.length && r.items.length && r.items[0].seq > latest+1;
    const map=new Map((gap?[]:old).map(x=>[x._id,x]));r.items.forEach(x=>map.set(x._id,x));const items=this.display(Array.from(map.values()).sort((a,b)=>a.seq-b.seq));
    const update={items,error:'',loading:false};if(!old.length||gap)update.more=r.more;
    if(r.latestSeq>latest)update.bottom=items.length?'m'+items[items.length-1].seq:'';
    this.setData(update);
    if(r.items.length)await api.call('chat.read',{roomId:this.roomId,seq:r.items[r.items.length-1].seq});
  }catch(e){this.setData({error:e.message,loading:false});}finally{this.refreshing=false;if(this.visible){clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),4000);}}
 },
 async older(){if(this.olderBusy||!this.data.items.length)return;this.olderBusy=true;try{const r=await api.call('chat.messages',{roomId:this.roomId,before:this.data.items[0].seq});const map=new Map(r.items.concat(this.data.items).map(x=>[x._id,x]));this.setData({items:this.display(Array.from(map.values()).sort((a,b)=>a.seq-b.seq)),more:r.more});}catch(e){this.setData({error:e.message});}finally{this.olderBusy=false;}},
 input(e){this.setData({content:e.detail.value});},
 async send(){if(this.data.busy||!this.data.content.trim())return;const content=this.data.content.trim();if(!this.pending||this.pending.content!==content)this.pending={content,requestId:Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)};this.setData({busy:true,error:''});try{await api.call('chat.send',{roomId:this.roomId,...this.pending});this.pending=null;this.setData({content:''});await this.refresh();}catch(e){this.setData({error:e.message});}finally{this.setData({busy:false});}}
});
