import re,json,sys,glob
src=open('/home/claude/ref/forever/ui/sim/player/classes/capabilities_auto_gen.ts').read()
FACTION={'Human':'alliance','Dwarf':'alliance','NightElf':'alliance','Gnome':'alliance','HighOrderSkyborne':'alliance','Orc':'horde','Undead':'horde','Tauren':'horde','Troll':'horde','WindshaperSkyborne':'horde'}
NAME={'NightElf':'Night Elf','HighOrderSkyborne':'High Order Skyborne','WindshaperSkyborne':'Windshaper Skyborne'}
def caps(cls):
    rows=[l for l in src.split('\n') if f'[Class.Class{cls}]' in l]
    armor=[a.lower() for a in re.findall(r'ArmorType\.ArmorType(\w+)',rows[0])]
    weapons=re.findall(r'WeaponType\.WeaponType(\w+), canUseTwoHand: (true|false)',rows[1])
    ranged=[r[0].lower()+r[1:] for r in re.findall(r'RangedWeaponType\.RangedWeaponType(\w+)',rows[2])]
    races=re.findall(r'Race\.Race(\w+)',rows[4])
    low=lambda w:w[0].lower()+w[1:]
    one=[low(w) for w,_ in weapons if w not in('OffHand','Shield','Polearm','Staff')]
    two=[low(w) for w,t in weapons if t=='true']
    off=[low(w) for w,_ in weapons if w in('OffHand','Shield')]
    return {'armorTypes':sorted(armor,key=['cloth','leather','mail','plate'].index),'one':one,'two':two,'off':off,'rangedTypes':ranged,'races':[{'id':'Race'+r,'name':NAME.get(r,r),'faction':FACTION[r]} for r in races]}
if __name__=='__main__':
    for cls in sys.argv[1:]:
        c=caps(cls); print(cls,json.dumps({k:v for k,v in c.items() if k!='races'}),[r['name'] for r in c['races']])
        for f in glob.glob(f'src/specs/{cls.lower()}-*.json'):
            d=json.load(open(f)); d['races']=c['races']; d['armorTypes']=c['armorTypes']; d['rangedTypes']=c['rangedTypes']
            d['weaponTypes']={'oneHand':c['one'],'twoHand':c['two'] if d['weaponSetup']!='oneHand' else [],'offHand':[] if d.get('canDualWield') else c['off']}
            json.dump(d,open(f,'w'),indent='\t'); open(f,'a').write('\n')
