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

def draw_text(c,e,x,y,w,h,text=None):
    text=e.get('text','') if text is None else text; size=max(4,float(e.get('fontSize',24))); fn=font_name(e.get('fontFamily'),e.get('fontWeight',400)>=700,e.get('italic',False)); c.setFont(fn,size); c.setFillColor(hexcolor(e.get('color'),'#202124'))
    lines=wrap(text,fn,size,max(1,w-8)); leading=size*1.2; total=len(lines)*leading; va=e.get('verticalAlign','top')
    top=y+h-4 if va=='top' else y+(h+total)/2 if va=='middle' else y+total+4
    from reportlab.pdfbase.pdfmetrics import stringWidth
    for i,line in enumerate(lines):
        yy=top-(i+1)*leading; align=e.get('align','left'); sw=stringWidth(line,fn,size); xx=x+4 if align=='left' else x+(w-sw)/2 if align=='center' else x+w-sw-4
        c.drawString(xx,yy,line)
        if e.get('underline'): c.setLineWidth(max(.5,size/18)); c.line(xx,yy-2,xx+sw,yy-2)

def draw_arrow(c,x1,y1,x2,y2,color,width,start=False,end=True):
    c.setStrokeColor(color); c.setFillColor(color); c.setLineWidth(width); c.line(x1,y1,x2,y2)
    def head(ax,ay,bx,by):
        ang=math.atan2(by-ay,bx-ax); length=max(7,width*4); spread=.55
        p1=(bx-length*math.cos(ang-spread),by-length*math.sin(ang-spread)); p2=(bx-length*math.cos(ang+spread),by-length*math.sin(ang+spread)); path=c.beginPath(); path.moveTo(bx,by); path.lineTo(*p1); path.lineTo(*p2); path.close(); c.drawPath(path,fill=1,stroke=0)
    if end: head(x1,y1,x2,y2)
    if start: head(x2,y2,x1,y1)

def image_reader(deck_path,e):
    src=(deck_path.parent/e['path']).resolve(); im=Image.open(src); l,t,r,b=(float(e.get('crop',{}).get(k,0)) for k in ('left','top','right','bottom')); iw,ih=im.size; box=(int(iw*l/100),int(ih*t/100),max(1,int(iw*(100-r)/100)),max(1,int(ih*(100-b)/100))); im=im.crop(box); buf=io.BytesIO(); fmt='PNG' if im.mode in ('RGBA','LA','P') else 'JPEG'; im.save(buf,fmt); buf.seek(0); return ImageReader(buf)

def draw_element(c,e,deck_path,byid):
    if e['type']=='connector':
        (a,b)=connector_points(e,byid); x1,y1=pct_x(a[0]),pct_y(a[1]); x2,y2=pct_x(b[0]),pct_y(b[1]); col=hexcolor(e.get('stroke'),'#4b4d50'); c.saveState(); c.setDash([6,5] if e.get('dash') else []); draw_arrow(c,x1,y1,x2,y2,col,max(.5,float(e.get('strokeWidth',2))),e.get('arrow')=='both',e.get('arrow') in ('end','both')); c.restoreState(); return
    x=pct_x(e.get('x',0)); w=pct_x(e.get('width',0)); h=float(e.get('height',0))*H/100; y=H-float(e.get('y',0))*H/100-h; c.saveState(); c.setFillAlpha(float(e.get('opacity',1))); c.setStrokeAlpha(float(e.get('opacity',1))); rot=float(e.get('rotation',0));
    if rot: c.translate(x+w/2,y+h/2); c.rotate(-rot); x,y=-w/2,-h/2
    typ=e['type']
    if typ=='image': c.drawImage(image_reader(deck_path,e),x,y,w,h,mask='auto',preserveAspectRatio=False)
    elif typ in ('text','shape'):
        fill=e.get('fill','transparent'); stroke=e.get('stroke','transparent'); sw=float(e.get('strokeWidth',1)); c.setLineWidth(sw); c.setFillColor(hexcolor(fill,'#ffffff')); c.setStrokeColor(hexcolor(stroke,'#000000')); dofill=fill!='transparent'; dostroke=stroke!='transparent' and sw>0
        if typ=='shape':
            sh=e.get('shape','rect')
            if sh=='ellipse': c.ellipse(x,y,x+w,y+h,fill=dofill,stroke=dostroke)
            elif sh=='rounded-rect': c.roundRect(x,y,w,h,min(w,h)*.12,fill=dofill,stroke=dostroke)
            elif sh in ('line','arrow'): draw_arrow(c,x,y+h/2,x+w,y+h/2,hexcolor(stroke,'#000000'),max(.5,sw),False,sh=='arrow')
            else: c.rect(x,y,w,h,fill=dofill,stroke=dostroke)
        elif dofill or dostroke: c.rect(x,y,w,h,fill=dofill,stroke=dostroke)
        if typ=='text' or e.get('text'): draw_text(c,e,x,y,w,h)
    elif typ=='table':
        rows,cols=e['rows'],e['cols']; cw,ch=w/cols,h/rows
        for rr in range(rows):
            for cc in range(cols):
                xx=x+cc*cw; yy=y+h-(rr+1)*ch; c.setFillColor(hexcolor(e.get('headerFill') if rr==0 else e.get('fill'),'#ffffff')); c.setStrokeColor(hexcolor(e.get('stroke'),'#777777')); c.setLineWidth(float(e.get('strokeWidth',1))); c.rect(xx,yy,cw,ch,fill=1,stroke=1); draw_text(c,e,xx,yy,cw,ch,e['cells'][rr][cc])
    c.restoreState()

def main():
    if len(sys.argv)!=3: raise SystemExit('usage: export-pdf.py deck.morrowdeck output.pdf')
    deck_path=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2]).resolve(); deck=json.loads(deck_path.read_text()); out.parent.mkdir(parents=True,exist_ok=True); c=canvas.Canvas(str(out),pagesize=(W,H),pageCompression=1)
    for slide in deck['slides']:
        c.setFillColor(hexcolor(slide.get('background',deck.get('theme',{}).get('background','#ffffff')),'#ffffff')); c.rect(0,0,W,H,fill=1,stroke=0)
        layout=slide.get('layout','title-body'); theme=deck.get('theme',{}); title=slide.get('title',''); body=slide.get('body','')
        if layout!='blank' and title:
            te={'text':title,'fontFamily':theme.get('titleFontFamily','Inter'),'fontSize':42 if layout=='title-body' else 54,'fontWeight':700,'color':theme.get('text','#202124'),'align':'center' if layout in ('title','section') else 'left','verticalAlign':'middle'}; draw_text(c,te,82,330 if layout=='title-body' else 190,796,120,title)
        if layout in ('title-body','section') and body:
            be={'text':body,'fontFamily':theme.get('fontFamily','Inter'),'fontSize':24,'fontWeight':400,'color':theme.get('text','#202124'),'align':'center' if layout=='section' else 'left','verticalAlign':'top'}; draw_text(c,be,82,95 if layout=='title-body' else 100,796,220,body)
        byid={e['id']:e for e in slide.get('elements',[])}
        for e in slide.get('elements',[]): draw_element(c,e,deck_path,byid)
        c.showPage()
    c.save(); print(out)
if __name__=='__main__': main()
