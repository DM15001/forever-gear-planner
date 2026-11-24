import json,sys
# usage: mkguide.py specId classId url author updated  < lines "slot|name"
sid,cid,url,author,updated=sys.argv[1],int(sys.argv[2]),sys.argv[3],sys.argv[4],sys.argv[5]
items=json.load(open('src/data/items.json')); by={}
for i in items: by.setdefault((i['name'].lower(),i['slot']),[]).append(i)
out=[];seen=set();miss=[]
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    slot,name=line.split('|'); slot=slot.split(' ')[0]
    c=by.get((name.lower(),slot),[])
    ok=[i for i in c if not i.get('classes') or cid in i['classes']] or c
    if not ok: miss.append(name); continue
    for i in ok[:2]:
        if i['id'] in seen: continue
        seen.add(i['id']); out.append({'slot':slot,'rank':'BiS','id':i['id'],'name':i['name']})
json.dump({"id":"wowhead","label":"Wowhead","title":"Wowhead BiS guide","url":url,"author":author,"updated":updated,"checked":"2026-11-22","note":"Only the guide's top (BiS) picks per slot are kept here, as a pointer. The full ranked tables with the author's reasoning are on Wowhead, see url.","ranks":["BiS"],"items":out},open(f'src/config/guides/{sid}.wowhead.json','w'),indent='\t')
print(sid,len(out),'missing',miss)
