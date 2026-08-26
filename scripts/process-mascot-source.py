from PIL import Image
from pathlib import Path
from collections import deque

root=Path('mascot-source'); out=Path('public/mascot'); out.mkdir(parents=True,exist_ok=True)
mapping={
 'photo_2026-08-25_15-15-13 (4).jpg':'mascot-face.png',
 'photo_2026-08-25_15-15-13.jpg':'mascot-neutral.png',
 'photo_2026-08-25_15-15-14 (3).jpg':'mascot-open.png',
 'photo_2026-08-25_15-15-14.jpg':'mascot-thinking.png',
 'photo_2026-08-25_15-15-14 (2).jpg':'mascot-surprised.png',
 'photo_2026-08-25_15-15-13 (3).jpg':'mascot-happy.png',
}

def background_mask(im):
    w,h=im.size; pix=im.load(); bg=bytearray(w*h); q=deque()
    def candidate(x,y):
      r,g,b=pix[x,y]; mx=max(r,g,b); mn=min(r,g,b)
      return mn>190 and mx-mn<38
    for x in range(w):
      for y in (0,h-1):
       if candidate(x,y): bg[y*w+x]=1;q.append((x,y))
    for y in range(h):
      for x in (0,w-1):
       if candidate(x,y) and not bg[y*w+x]:bg[y*w+x]=1;q.append((x,y))
    while q:
      x,y=q.popleft()
      for nx,ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
       if 0<=nx<w and 0<=ny<h and not bg[ny*w+nx] and candidate(nx,ny):
        bg[ny*w+nx]=1;q.append((nx,ny))
    return bg

def extract(im):
    rgba=im.convert('RGBA'); w,h=rgba.size; mask=background_mask(im); px=rgba.load()
    for y in range(h):
      for x in range(w):
       if mask[y*w+x]: px[x,y]=(px[x,y][0],px[x,y][1],px[x,y][2],0)
    return rgba

def crop_pad(im,pad_ratio=.035):
    a=im.getchannel('A'); box=a.getbbox()
    l,t,r,b=box; bw=r-l; bh=b-t; pad=max(12,int(max(bw,bh)*pad_ratio))
    l=max(0,l-pad);t=max(0,t-pad);r=min(im.width,r+pad);b=min(im.height,b+pad)
    return im.crop((l,t,r,b))

for src,dst in mapping.items():
    im=Image.open(root/src).convert('RGB')
    if dst=='mascot-face.png':
      side=min(im.size);left=(im.width-side)//2;top=(im.height-side)//2
      result=im.crop((left,top,left+side,top+side)).convert('RGBA')
    else: result=crop_pad(extract(im))
    result.save(out/dst,'PNG',compress_level=4)
    a=result.getchannel('A'); print(dst,result.size,a.getextrema(),a.getbbox())
