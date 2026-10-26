export type MediaSize={width:number;height:number};
export const FEED_NAVIGATION_HEIGHT=64;
export const validMediaSize=(size:MediaSize|null|undefined):size is MediaSize=>!!size&&Number.isFinite(size.width)&&Number.isFinite(size.height)&&size.width>0&&size.height>0;
export function feedGeometry(width:number,height:number,size?:MediaSize|null){
  const w=Number.isFinite(width)?Math.max(0,width):0,h=Number.isFinite(height)?Math.max(0,height):0;
  const mediaHeight=validMediaSize(size)?w*size.height/size.width:h;
  const resolved=Number.isFinite(mediaHeight)&&mediaHeight>0;
  const fitted=resolved?mediaHeight:h;
  return {width:w,pageHeight:h,mediaHeight:fitted,mediaTop:fitted>h?-(fitted-h)/2:0,visibleHeight:Math.min(h,fitted),knownSize:validMediaSize(size)&&resolved};
}
