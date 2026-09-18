from pathlib import Path
from PIL import Image,ImageDraw
import sys,shutil,json
if int(sys.argv[1][:2])<8:raise SystemExit('Archived sources are protected. Choose a new output stage.')
stage=sys.argv[1];p=Path('stages')/stage;files=sorted(f for f in p.glob('*.png') if f.name[:2].isdigit());out=Image.new('RGB',(1200,((len(files)+2)//3)*250),'#17232c');d=ImageDraw.Draw(out)
if (p/'complete.json').exists():raise SystemExit('Completed sources are protected. Choose a new output stage.')
for i,f in enumerate(files):
 im=Image.open(f);im.thumbnail((390,219));x=i%3*400;y=i//3*250;out.paste(im,(x,y));d.text((x+8,y+223),f.stem,fill='white')
out.save(p/'contact.jpg')
if stage!='01-baseline':
 dst=p/'source';dst.mkdir(exist_ok=True)
 for f in Path('webgpu').glob('*'):
  if f.is_file() and f.suffix in ['.js','.html','.json','.md']:shutil.copy2(f,dst/f.name)
 shutil.copytree('webgpu/vendor',dst/'vendor',dirs_exist_ok=True)
