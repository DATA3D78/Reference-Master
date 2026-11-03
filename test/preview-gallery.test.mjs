import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PreviewGallery,previewArrowStep} from '../public/library.js';
const item=key=>({key,url:'/media/'+key,caption:key,contentType:'image/png'});
test('preview follows the visible collection order from the clicked image and wraps in both directions',()=>{
 const gallery=new PreviewGallery();gallery.open(['c','a','b'].map(item),item('a'));
 assert.equal(gallery.current.key,'a');assert.equal(gallery.move(1).key,'b');assert.equal(gallery.move(1).key,'c');assert.equal(gallery.move(-1).key,'b');
 assert.equal(gallery.items.length,3);assert.equal(gallery.index,2);
});
test('preview deduplicates references, handles single images, and resets between collections',()=>{
 const gallery=new PreviewGallery();gallery.open([item('a'),item('a')],item('a'));assert.equal(gallery.items.length,1);assert.equal(gallery.move(-1).key,'a');
 gallery.open([item('asset')],item('asset'));assert.equal(gallery.current.key,'asset');assert.equal(gallery.items.length,1);
 gallery.open([],item('missing-from-stale-list'));assert.equal(gallery.current.key,'missing-from-stale-list');gallery.clear();assert.equal(gallery.move(1),undefined);assert.equal(gallery.items.length,0);
});
test('arrow shortcuts do not steal text editing, video seeking or modified keys',()=>{
 assert.equal(previewArrowStep({key:'ArrowLeft'}),-1);assert.equal(previewArrowStep({key:'ArrowRight'}),1);assert.equal(previewArrowStep({key:'Escape'}),0);
 for(const flag of ['ctrlKey','altKey','metaKey','shiftKey','defaultPrevented'])assert.equal(previewArrowStep({key:'ArrowRight',[flag]:true}),0);
 assert.equal(previewArrowStep({key:'ArrowLeft',target:{isContentEditable:true}}),0);
 assert.equal(previewArrowStep({key:'ArrowLeft',target:{closest:selector=>selector.includes('video')}}),0);
});


test('deleting the current preview advances safely and Undo restores its original order',()=>{
 const gallery=new PreviewGallery();gallery.open(['a','b','c'].map(item),item('b'));
 gallery.remove('b');assert.equal(gallery.current.key,'c');assert.deepEqual(gallery.items.map(i=>i.key),['a','c']);
 gallery.restore(item('b'),1);assert.equal(gallery.current.key,'c');assert.deepEqual(gallery.items.map(i=>i.key),['a','b','c']);
 gallery.remove('c');assert.equal(gallery.current.key,'b');gallery.remove('b');gallery.remove('a');assert.equal(gallery.current,undefined);assert.equal(gallery.index,0);
 gallery.restore(item('a'),0);assert.equal(gallery.current.key,'a');
});
test('a delayed deletion preserves the item reached with arrows and never affects a different preview collection',()=>{
 const gallery=new PreviewGallery();gallery.open(['a','b','c'].map(item),item('a'));const deleted=gallery.current;
 gallery.move(1);gallery.remove(deleted.key);assert.equal(gallery.current.key,'b');assert.equal(gallery.index,0);
 gallery.open([item('other')],item('other'));gallery.remove(deleted.key);assert.equal(gallery.current.key,'other');
 gallery.restore(item('other'),0);assert.equal(gallery.items.length,1);
});
test('preview metadata keeps action targets and downloads attached to the displayed image or video',()=>{
 const gallery=new PreviewGallery(),image={...item('image'),job:{id:'job-a'},media:{id:'image-a'},downloadURL:'/download/image-a'},video={...item('video'),contentType:'video/mp4',job:{id:'job-b'},media:{id:'video-b'},downloadURL:'/download/video-b'};
 gallery.open([image,video],image);assert.equal(gallery.current.media.id,'image-a');gallery.move(1);assert.equal(gallery.current.job.id,'job-b');assert.equal(gallery.current.downloadURL,'/download/video-b');
});
