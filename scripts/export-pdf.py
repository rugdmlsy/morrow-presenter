#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["reportlab>=4.2", "Pillow>=10"]
# ///
from __future__ import annotations
import io, json, math, sys
from pathlib import Path
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.utils import ImageReader

W,H=960.0,540.0

def pct_x(v): return float(v)*W/100.0
def pct_y(v): return H-float(v)*H/100.0
def hexcolor(v, default='#000000'):
    try:return HexColor(v if isinstance(v,str) and v.startswith('#') else default)
    except:return HexColor(default)
def font_name(name,bold=False,italic=False):
    low=(name or '').lower(); base='Times' if 'times' in low or 'georgia' in low else ('Courier' if 'courier' in low else 'Helvetica')
    if base=='Times': return 'Times-BoldItalic' if bold and italic else 'Times-Bold' if bold else 'Times-Italic' if italic else 'Times-Roman'
    return f'{base}-BoldOblique' if bold and italic else f'{base}-Bold' if bold else f'{base}-Oblique' if italic else base

def wrap(text,font,size,maxw):
    out=[]
    for para in str(text).splitlines() or ['']:
        words=para.split(' '); line=''
        if len(words)==1 and words[0]==para and ' ' not in para:
            chars=list(para); line=''
            for ch in chars:
                cand=line+ch
                from reportlab.pdfbase.pdfmetrics import stringWidth
                if line and stringWidth(cand,font,size)>maxw: out.append(line); line=ch
                else: line=cand
            out.append(line); continue
        from reportlab.pdfbase.pdfmetrics import stringWidth
        for word in words:
            cand=word if not line else line+' '+word
            if line and stringWidth(cand,font,size)>maxw: out.append(line); line=word
            else: line=cand
        out.append(line)
    return out

def anchor_point(endpoint, other, byid):
    eid=endpoint.get('elementId')
    if eid and eid in byid:
        e=byid[eid]; cx=e.get('x',0)+e.get('width',0)/2; cy=e.get('y',0)+e.get('height',0)/2; a=endpoint.get('anchor','auto')
        if a=='auto': a=('right' if other[0]>=cx else 'left') if abs(other[0]-cx)>abs(other[1]-cy) else ('bottom' if other[1]>=cy else 'top')
        if a=='top': return cx,e.get('y',0)
        if a=='right': return e.get('x',0)+e.get('width',0),cy
        if a=='bottom': return cx,e.get('y',0)+e.get('height',0)
        if a=='left': return e.get('x',0),cy
        return cx,cy
    return float(endpoint.get('x',10)),float(endpoint.get('y',10))
def connector_points(e,byid):
    def center(ep,default):
        eid=ep.get('elementId'); x=byid.get(eid) if eid else None
        return (x.get('x',0)+x.get('width',0)/2,x.get('y',0)+x.get('height',0)/2) if x else default
    a=center(e['from'],(10,10)); b=center(e['to'],(80,80)); a=anchor_point(e['from'],b,byid); b=anchor_point(e['to'],a,byid); return a,b

def paragraph_lines(text,font,size,maxw,list_style='none'):
    result=[]
    paragraphs=str(text).split('\n') if str(text) else ['']
    for pi,para in enumerate(paragraphs):
        prefix='• ' if list_style=='bullet' else f'{pi+1}. ' if list_style=='number' else ''
        raw=prefix+para
        lines=wrap(raw,font,size,maxw)
        for li,line in enumerate(lines): result.append((line, li==len(lines)-1))
    return result

def text_layout(e,text,w,h,size):
    fn=font_name(e.get('fontFamily'),e.get('fontWeight',400)>=700,e.get('italic',False)); indent=float(e.get('indent',0)); maxw=max(1,w-8-indent); lines=paragraph_lines(text,fn,size,maxw,e.get('listStyle','none')); leading=size*float(e.get('lineSpacing',1.2)); para=float(e.get('paragraphSpacing',0)); total=sum(leading+(para if end and i<len(lines)-1 else 0) for i,(_,end) in enumerate(lines)); return fn,lines,leading,para,total

def draw_text(c,e,x,y,w,h,text=None):
    text=e.get('text','') if text is None else text; size=max(4,float(e.get('fontSize',24)))
    while True:
        fn,lines,leading,para,total=text_layout(e,text,w,h,size)
        if not e.get('autoFit') or total<=max(1,h-8) or size<=4: break
        size=max(4,size-1)
    c.setFont(fn,size); c.setFillColor(hexcolor(e.get('color'),'#202124')); va=e.get('verticalAlign','top')
    top=y+h-4 if va=='top' else y+(h+total)/2 if va=='middle' else y+total+4
    from reportlab.pdfbase.pdfmetrics import stringWidth
    indent=float(e.get('indent',0)); cursor=top
    for i,(line,para_end) in enumerate(lines):
        cursor-=leading; align=e.get('align','left'); sw=stringWidth(line,fn,size); xx=x+4+indent if align=='left' else x+(w-sw)/2 if align=='center' else x+w-sw-4
        c.drawString(xx,cursor,line)
        if e.get('underline'): c.setLineWidth(max(.5,size/18)); c.line(xx,cursor-2,xx+sw,cursor-2)
        if para_end and i<len(lines)-1: cursor-=para

def draw_arrow(c,x1,y1,x2,y2,color,width,start=False,end=True):
    c.setStrokeColor(color); c.setFillColor(color); c.setLineWidth(width); c.line(x1,y1,x2,y2)
    def head(ax,ay,bx,by):
        ang=math.atan2(by-ay,bx-ax); length=max(7,width*4); spread=.55
        p1=(bx-length*math.cos(ang-spread),by-length*math.sin(ang-spread)); p2=(bx-length*math.cos(ang+spread),by-length*math.sin(ang+spread)); path=c.beginPath(); path.moveTo(bx,by); path.lineTo(*p1); path.lineTo(*p2); path.close(); c.drawPath(path,fill=1,stroke=0)
    if end: head(x1,y1,x2,y2)
    if start: head(x2,y2,x1,y1)

def image_reader(deck_path,e):
    src=(deck_path.parent/e['path']).resolve(); im=Image.open(src); l,t,r,b=(float(e.get('crop',{}).get(k,0)) for k in ('left','top','right','bottom')); iw,ih=im.size; box=(int(iw*l/100),int(ih*t/100),max(1,int(iw*(100-r)/100)),max(1,int(ih*(100-b)/100))); im=im.crop(box); buf=io.BytesIO(); fmt='PNG' if im.mode in ('RGBA','LA','P') else 'JPEG'; im.save(buf,fmt); buf.seek(0); return ImageReader(buf)

def polygon_points(kind,x,y,w,h):
    pts={
      'triangle':[(.5,1),(1,0),(0,0)],
      'diamond':[(.5,1),(1,.5),(.5,0),(0,.5)],
      'pentagon':[(.5,1),(.98,.62),(.8,0),(.2,0),(.02,.62)],
      'hexagon':[(.25,1),(.75,1),(1,.5),(.75,0),(.25,0),(0,.5)],
      'star':[(.5,1),(.61,.65),(.98,.65),(.68,.43),(.79,0),(.5,.27),(.21,0),(.32,.43),(.02,.65),(.39,.65)],
      'chevron':[(0,1),(.62,1),(1,.5),(.62,0),(0,0),(.38,.5)],
    }.get(kind)
    return [(x+px*w,y+py*h) for px,py in pts] if pts else None

def draw_polygon(c,pts,fill,stroke):
    path=c.beginPath();path.moveTo(*pts[0]);
    for pt in pts[1:]:path.lineTo(*pt)
    path.close();c.drawPath(path,fill=fill,stroke=stroke)

def draw_element(c,e,deck_path,byid):
    if e['type']=='connector':
        (a,b)=connector_points(e,byid); x1,y1=pct_x(a[0]),pct_y(a[1]); x2,y2=pct_x(b[0]),pct_y(b[1]); col=hexcolor(e.get('stroke'),'#4b4d50'); c.saveState(); c.setDash([6,5] if e.get('dash') else []); draw_arrow(c,x1,y1,x2,y2,col,max(.5,float(e.get('strokeWidth',2))),e.get('arrow')=='both',e.get('arrow') in ('end','both')); c.restoreState(); return
    x=pct_x(e.get('x',0)); w=pct_x(e.get('width',0)); h=float(e.get('height',0))*H/100; y=H-float(e.get('y',0))*H/100-h; c.saveState(); c.setFillAlpha(float(e.get('opacity',1))); c.setStrokeAlpha(float(e.get('opacity',1))); rot=float(e.get('rotation',0));
    if rot: c.translate(x+w/2,y+h/2); c.rotate(-rot); x,y=-w/2,-h/2
    typ=e['type']; flip_h=bool(e.get('flipH'));flip_v=bool(e.get('flipV'))
    if typ=='image' and (flip_h or flip_v):
        c.translate(x+w/2,y+h/2);c.scale(-1 if flip_h else 1,-1 if flip_v else 1);x,y=-w/2,-h/2
    if typ=='image': c.drawImage(image_reader(deck_path,e),x,y,w,h,mask='auto',preserveAspectRatio=False)
    elif typ in ('text','shape'):
        fill=e.get('fill','transparent'); stroke=e.get('stroke','transparent'); sw=float(e.get('strokeWidth',1)); c.setLineWidth(sw); c.setFillColor(hexcolor(fill,'#ffffff')); c.setStrokeColor(hexcolor(stroke,'#000000')); dofill=fill!='transparent'; dostroke=stroke!='transparent' and sw>0
        if typ=='shape':
            sh=e.get('shape','rect');sx,sy=x,y;c.saveState()
            if flip_h or flip_v:
                c.translate(x+w/2,y+h/2);c.scale(-1 if flip_h else 1,-1 if flip_v else 1);sx,sy=-w/2,-h/2
            if sh=='ellipse': c.ellipse(sx,sy,sx+w,sy+h,fill=dofill,stroke=dostroke)
            elif sh=='rounded-rect': c.roundRect(sx,sy,w,h,min(w,h)*.12,fill=dofill,stroke=dostroke)
            elif sh in ('line','arrow'): draw_arrow(c,sx,sy+h/2,sx+w,sy+h/2,hexcolor(stroke,'#000000'),max(.5,sw),False,sh=='arrow')
            elif polygon_points(sh,sx,sy,w,h): draw_polygon(c,polygon_points(sh,sx,sy,w,h),dofill,dostroke)
            else: c.rect(sx,sy,w,h,fill=dofill,stroke=dostroke)
            c.restoreState()
        elif dofill or dostroke: c.rect(x,y,w,h,fill=dofill,stroke=dostroke)
        if typ=='text' or e.get('text'): draw_text(c,e,x,y,w,h)
    elif typ=='table':
        rows,cols=e['rows'],e['cols']; cw,ch=w/cols,h/rows
        for rr in range(rows):
            for cc in range(cols):
                xx=x+cc*cw; yy=y+h-(rr+1)*ch; c.setFillColor(hexcolor(e.get('headerFill') if rr==0 else e.get('fill'),'#ffffff')); c.setStrokeColor(hexcolor(e.get('stroke'),'#777777')); c.setLineWidth(float(e.get('strokeWidth',1))); c.rect(xx,yy,cw,ch,fill=1,stroke=1); draw_text(c,e,xx,yy,cw,ch,e['cells'][rr][cc])
    c.restoreState()

def draw_footer(c,deck,index):
    f=deck.get('footer',{});
    if not f.get('showText') and not f.get('showSlideNumber'): return
    c.saveState();size=float(f.get('fontSize',11));c.setFont(font_name(f.get('fontFamily')),size);c.setFillColor(hexcolor(f.get('color'),'#666666'));y=max(8,H*.022)
    if f.get('showText'): c.drawString(W*.04,y,str(f.get('text','')))
    if f.get('showSlideNumber'):
        text=str(index+1);from reportlab.pdfbase.pdfmetrics import stringWidth;c.drawString(W*.96-stringWidth(text,font_name(f.get('fontFamily')),size),y,text)
    c.restoreState()

def main():
    global W,H
    if len(sys.argv)!=3: raise SystemExit('usage: export-pdf.py deck.morrowdeck output.pdf')
    deck_path=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2]).resolve(); deck=json.loads(deck_path.read_text());page=deck.get('page',{});W=float(page.get('width',13.333333))*72;H=float(page.get('height',7.5))*72;out.parent.mkdir(parents=True,exist_ok=True); c=canvas.Canvas(str(out),pagesize=(W,H),pageCompression=1)
    for index,slide in enumerate(deck['slides']):
        c.setFillColor(hexcolor(slide.get('background',deck.get('theme',{}).get('background','#ffffff')),'#ffffff')); c.rect(0,0,W,H,fill=1,stroke=0)
        byid={e['id']:e for e in slide.get('elements',[])}
        for e in slide.get('elements',[]): draw_element(c,e,deck_path,byid)
        draw_footer(c,deck,index);c.showPage()
    c.save(); print(out)
if __name__=='__main__': main()
