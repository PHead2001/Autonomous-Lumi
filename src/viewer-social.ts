import {SOCIAL_LIMITS,type SocialWorldView,type SocialIntentFeedback} from '../shared/social-protocol';
import type {VisitWorldView} from '../shared/visit-protocol';
import type {WorldState} from '../shared/protocol';

export interface PendingSocialRequest {actionId:number;sequence:number;kind:SocialIntentFeedback['kind']}
/** A shared action cursor or transport ACK cannot prove this particular mutation applied. */
export function socialRequestResult(pending:PendingSocialRequest|null,feedback:SocialIntentFeedback|null|undefined) {
  if(!pending||!feedback||feedback.actionId!==pending.actionId||feedback.kind!==pending.kind)return null;
  if(feedback.outcome==='accepted')return {message:feedback.kind==='offer'?'Offer request confirmed. See the current offer outcome.':feedback.kind==='cancel'?'Offer cancellation confirmed.':'Badge display change confirmed. Visibility, attention and encoding remain separate.',outcome:feedback.outcome};
  const reason=({owner_moving:'Stop moving, then retry.',out_of_reach:'Move closer to Lumi, then retry.',offer_pending:'An offer is already pending. Wait for its outcome or cancel it.',item_not_held:'You no longer hold that item.',duplicate_action:'This action was already processed. Check the current outcome.',stale_sequence:'Control changed. Re-enter Visit before retrying.',stale_generation:'Control changed. Re-enter Visit before retrying.',wrong_run:'The selected world changed. Re-enter Visit before retrying.',control_inactive:'Re-enter Visit before retrying.',offer_not_pending:'The offer has already ended.',no_pending_offer:'The offer has already ended.',offer_mismatch:'The current offer changed. Check its outcome before retrying.'} as Record<string,string>)[feedback.reason]??'The server did not apply this request. Check the current state before retrying.';
  return {message:`${feedback.kind==='offer'?'Offer was not created':feedback.kind==='cancel'?'Offer cancellation was not completed':'Badge display was not changed'}. ${reason}`,outcome:feedback.outcome};
}

/** Public transaction state describes what happened, never a motive or relationship. */
export function offerPresentation(social:SocialWorldView|undefined) {
  const o=social?.offer;
  if(!social)return {title:'Offers unavailable',detail:'This historical world does not support offers.'};
  if(!o)return {title:'No offer in progress',detail:'A real offer creates a sensory opportunity. Lumi may not notice or respond.'};
  if(o.status==='pending')return o.noticedTick===null?{title:'Offer pending · Not yet noticed',detail:'Your item is reserved. No response or transfer has been confirmed.'}:o.response==='ignore'?{title:'Offer noticed · No response',detail:'No transfer was committed. The pending offer may expire or be cancelled.'}:{title:'Offer noticed · Awaiting a response',detail:'Your item remains reserved. A transfer has not been confirmed.'};
  if(o.status==='accepted')return {title:'Offer accepted',detail:'Ownership transfer is confirmed. Eating, if any, is a separate validated action.'};
  if(o.status==='declined')return {title:'Offer declined',detail:'The item remains with its owner; no transfer was committed.'};
  if(o.status==='deferred')return {title:'Offer deferred',detail:'No transfer was committed. A later attempt would be a new offer.'};
  if(o.status==='cancelled')return {title:'Offer cancelled',detail:'The reservation was released without transferring the item.'};
  return o.noticedTick===null?{title:'Offer expired without notice',detail:'No notice, deliberate decline or transfer was recorded.'}:{title:'Offer expired',detail:'The offer ended without a committed transfer.'};
}

/** Advisory controls use current public possession/reach; the server revalidates every request. */
export function socialControls(social:SocialWorldView|undefined,visit:VisitWorldView|undefined,character:WorldState['character'],active:boolean) {
  const actor=visit?.actor,offer=social?.offer,pending=offer?.status==='pending',item=actor?.heldItemId===null?undefined:visit?.inventory.find(i=>i.id===actor?.heldItemId);
  const held=!!item&&item.kind===actor?.heldItem&&['fruit','bread'].includes(item.kind),near=!!actor&&Math.hypot(actor.x-character.x,actor.z-character.z)<=SOCIAL_LIMITS.reach;
  const hint=!social?'Offers are unavailable in this historical world.':!active?'Enter Visit to offer an owned item.':pending?'An offer is already pending. Wait for its outcome or cancel it.':!held?'Purchase and hold a permitted food item first.':!near?'Approach Lumi before offering.':'Offer the held item. Notice and response are not guaranteed.';
  return {canOffer:!!social&&active&&held&&near&&!pending,canCancel:!!social&&active&&pending&&held&&offer.itemId===item?.id,canToggleBadge:!!social&&active,itemId:item?.id??null,offerId:offer?.id??null,hint};
}
