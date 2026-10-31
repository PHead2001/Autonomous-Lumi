import {DELIVERY_LIMITS,type DeliveryWorldView} from '../shared/delivery-protocol';
import type {VisitWorldView} from '../shared/visit-protocol';
import type {SocialWorldView} from '../shared/social-protocol';

export interface PendingDeliveryRequest {actionId:number;sequence:number}

/** Observer transaction history is not a description of Lumi's knowledge. */
export function deliveryPresentation(delivery:DeliveryWorldView|undefined) {
  if(!delivery)return {title:'Drop-off unavailable',detail:'This historical world has no persistent drop-off point.',entries:[] as string[]};
  const entries=delivery.items.map(item=>{
    if(item.consumedTick!==null)return `Delivery ${item.deliveryId}: consumed through a separate eating action.`;
    if(item.collectedTick!==null)return `Delivery ${item.deliveryId}: collected by Lumi; not yet consumed.`;
    if(item.openedTick!==null&&item.noticedTick!==null)return `Delivery ${item.deliveryId}: contents noticed; the item is still waiting for collection.`;
    if(item.openedTick!==null)return `Delivery ${item.deliveryId}: container opened; contents have not yet been reported noticed.`;
    if(item.noticedTick!==null)return `Delivery ${item.deliveryId}: item noticed; still waiting for collection.`;
    return `Delivery ${item.deliveryId}: deposited and waiting. No item notice is recorded.`;
  });
  return {
    title:delivery.occupied>=delivery.capacity?'Drop-off storage full':delivery.occupied?`${delivery.occupied} ${delivery.occupied===1?'item':'items'} waiting at the drop-off`:'Drop-off storage empty',
    detail:`${delivery.occupied} of ${delivery.capacity} storage spaces used · ${delivery.open?'Open':'Closed'}. Depositing, noticing, opening, collecting and eating are separate outcomes.`,entries,
  };
}

/** Advisory possession and proximity only; authority revalidates reach and sight. */
export function deliveryControls(delivery:DeliveryWorldView|undefined,visit:VisitWorldView|undefined,social:SocialWorldView|undefined,active:boolean) {
  const actor=visit?.actor,item=visit?.inventory.find(i=>i.id===actor?.heldItemId),held=!!item&&['fruit','bread'].includes(item.kind),reserved=!!item&&social?.offer?.status==='pending'&&social.offer.itemId===item.id;
  const near=!!delivery&&!!actor&&Math.hypot(actor.x-delivery.position.x,actor.z-delivery.position.z)<=DELIVERY_LIMITS.reach;
  const full=!!delivery&&delivery.occupied>=delivery.capacity;
  const hint=!delivery?'Persistent deliveries are unavailable in this historical world.':!active?'Enter Visit to deposit an owned item.':!held?'Buy and hold fruit or bread first.':reserved?'Cancel the pending in-person offer before depositing this item.':full?'Storage is full. Your item remains yours until a deposit succeeds.':!near?'Approach the drop-off shelf on the inside back wall.':'Stop near the drop-off and deposit your held item. Lumi may notice it later.';
  return {canDeposit:!!delivery&&active&&held&&!reserved&&!full&&near,itemId:item?.id??null,hint};
}

export function deliveryRequestResult(pending:PendingDeliveryRequest|null,feedback:DeliveryWorldView['feedback']|undefined) {
  if(!pending||!feedback||feedback.actionId!==pending.actionId)return null;
  if(feedback.outcome==='accepted')return {outcome:feedback.outcome,message:'Deposit completed. The item is stored; notice, collection and eating have not been implied.'};
  const reason=({storage_full:'Storage is full.',out_of_reach:'Move closer to the drop-off.',owner_moving:'Stop moving before depositing.',item_reserved:'Cancel the pending in-person offer first.',item_not_held:'Hold the item you intend to leave.',capacity_exhausted:'Persistent storage capacity is unavailable.',control_inactive:'Re-enter Visit.',stale_generation:'Control changed. Re-enter Visit.',wrong_run:'The selected world changed. Re-enter Visit.'} as Record<string,string>)[feedback.reason]??feedback.reason.replaceAll('_',' ');
  return {outcome:feedback.outcome,message:`Deposit rejected. ${reason} Check your current inventory before retrying.`};
}
