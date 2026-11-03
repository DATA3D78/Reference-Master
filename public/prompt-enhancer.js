const $=s=>document.querySelector(s);
export class PromptEnhancer{
  constructor(actions){
    this.actions=actions;this.applied=new Map();this.loading=0;this.busy=false;
    $('#enhance-toggle').addEventListener('click',()=>$('#enhance-menu').hidden?this.open():this.close());
    $('#enhance-menu').addEventListener('click',event=>{const button=event.target.closest('[data-enhance-preset]');if(button)void this.enhance(button.dataset.enhancePreset);});
    document.addEventListener('pointerdown',event=>{if(!event.target.closest('.prompt-field'))this.close();});
    $('.prompt-field').addEventListener('keydown',event=>{
      if($('#enhance-menu').hidden)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.close();$('#enhance-toggle').focus();return;}
      const buttons=[...$('#enhance-menu').querySelectorAll('[role=menuitem]')];
      if(buttons.length&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const index=buttons.indexOf(document.activeElement);
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length].focus();
      }
    });
    $('#prompt').addEventListener('input',()=>this.sync());
    $('#enhance-undo').addEventListener('click',()=>{
      const key=this.key(),last=this.applied.get(key);if(!last||$('#prompt').value!==last.output)return;
      this.actions.setPrompt(last.before);if(last.previous)this.applied.set(key,last.previous);else this.applied.delete(key);this.message('Previous prompt restored.');this.sync();
    });
  }
  // Image and Video share one prompt, so its appended preset travels with it.
  key(){return this.actions.context().projectId;}
  message(text){$('#enhance-message').textContent=text;$('#enhance-feedback').hidden=!text&&$('#enhance-undo').hidden;}
  sync(){
    const c=this.actions.context(),key=this.key();
    const contextKey=key+':'+c.mode;
    if(this.contextKey!==contextKey){this.contextKey=contextKey;this.close();this.message('');}
    const last=this.applied.get(key);$('#enhance-undo').hidden=!last||$('#prompt').value!==last.output||this.busy;
    $('#enhance-toggle').textContent=this.busy?'Enhancing…':'Enhance ▾';
    $('#enhance-toggle').disabled=this.busy;$('#enhance-feedback').hidden=!$('#enhance-message').textContent&&$('#enhance-undo').hidden;
    if(c.view==='llm')this.close();
  }
  close(){this.loading++;$('#enhance-menu').hidden=true;$('#enhance-toggle').setAttribute('aria-expanded','false');}
  async open(){
    if(this.busy)return;
    const context=this.actions.context(),version=++this.loading;
    $('#enhance-menu').hidden=false;$('#enhance-toggle').setAttribute('aria-expanded','true');$('#enhance-options').textContent='Loading presets…';
    try{
      const config=await this.actions.api('/api/prompt-presets?mode='+context.mode);
      if(version!==this.loading||this.key()!==context.projectId||this.actions.context().mode!==context.mode)return;
      this.config=config;$('#enhance-file').textContent=config.relativePath||'CUSTOM/'+config.filename;
      const items=[{id:'',title:'Enhance only',prompt:'Improve wording and clarity. No preset added.'},...config.presets];
      $('#enhance-options').replaceChildren(...items.map(item=>{
        const button=document.createElement('button');button.type='button';button.dataset.enhancePreset=item.id;button.setAttribute('role','menuitem');
        const title=document.createElement('strong'),detail=document.createElement('span');title.textContent=item.title;detail.textContent=item.prompt;button.append(title,detail);return button;
      }));
    }catch(error){if(version===this.loading)$('#enhance-options').textContent=error.message;}
  }
  async enhance(presetId){
    if(this.busy)return;
    const context=this.actions.context(),key=this.key(),before=$('#prompt').value,last=this.applied.get(key);
    let source=before;
    if(last&&before===last.output)source=last.enhanced;
    else if(last?.preset&&before.endsWith('\n\n'+last.preset))source=before.slice(0,-last.preset.length-2);
    if(!source.trim()){this.close();this.message('Write your prompt first.');$('#prompt').focus();return;}
    if(!this.config.keyConfigured){this.close();this.message('Connect OpenRouter, then choose Enhance again.');this.actions.openSettings();return;}
    this.close();this.busy=true;this.actions.busy(true);this.sync();this.message('Improving your wording…');
    try{
      const result=await this.actions.post('/api/enhance-prompt',{...context,prompt:source,presetId});
      if(this.key()!==key||this.actions.context().mode!==context.mode||$('#prompt').value!==before){this.message('Your prompt changed while enhancing. The edit was kept; no enhancement was applied.');return;}
      this.applied.set(key,{before,enhanced:result.enhanced,preset:result.preset?.prompt||'',output:result.combinedPrompt,previous:last||null});
      this.actions.setPrompt(result.combinedPrompt);this.message(result.preset?`Enhanced · ${result.preset.title} appended unchanged.`:'Wording enhanced. No preset added.');
    }catch(error){this.message(error.message);}
    finally{this.busy=false;this.actions.busy(false);this.sync();}
  }
}
